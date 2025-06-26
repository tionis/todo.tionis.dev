#!/usr/bin/env node

const { init } = require('@instantdb/admin');
const { Command } = require('commander');
const fs = require('fs');
const path = require('path');

// Initialize the CLI
const program = new Command();

program
  .name('instantdb-debug')
  .description('CLI tool to debug InstantDB databases')
  .version('1.0.0');

// Load environment variables from .env file if it exists
function loadEnv() {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        return;
      }
      
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex === -1) {
        return;
      }
      
      const key = trimmedLine.substring(0, equalIndex).trim();
      let value = trimmedLine.substring(equalIndex + 1).trim();
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      // Only set if not already in environment (environment variables take precedence)
      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    });
    console.log(`Loaded environment variables from ${envPath}`);
  }
}

// Initialize InstantDB with environment variables or provided options
function initDB(options) {
  loadEnv(); // Load .env file first
  
  const appId = options.appId || process.env.INSTANT_APP_ID;
  const adminToken = options.adminToken || process.env.INSTANT_APP_ADMIN_TOKEN;

  if (!appId) {
    console.error('Error: App ID is required. Provide it via --app-id or INSTANT_APP_ID environment variable.');
    process.exit(1);
  }

  if (!adminToken) {
    console.error('Error: Admin token is required. Provide it via --admin-token or INSTANT_APP_ADMIN_TOKEN environment variable.');
    process.exit(1);
  }

  try {
    // Try to load schema if it exists
    let schema;
    const schemaPath = path.resolve('instant.schema.ts');
    if (fs.existsSync(schemaPath)) {
      // For now, we'll skip schema loading since it requires compilation
      // In a production version, you might want to use ts-node or compile the schema
      console.log('Note: Schema file found but not loaded. Consider using compiled JavaScript schema for full type safety.');
    }

    return init({
      appId,
      adminToken,
      schema
    });
  } catch (error) {
    console.error('Error initializing InstantDB:', error.message);
    process.exit(1);
  }
}

// Format and display query results
function displayResults(data, format = 'json') {
  switch (format) {
    case 'json':
      console.log(JSON.stringify(data, null, 2));
      break;
    case 'table':
      // Simple table format for flat objects
      if (typeof data === 'object' && data !== null) {
        Object.entries(data).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            console.log(`\n${key} (${value.length} items):`);
            if (value.length > 0) {
              console.table(value);
            }
          } else {
            console.log(`${key}:`, value);
          }
        });
      } else {
        console.log(data);
      }
      break;
    case 'count':
      if (typeof data === 'object' && data !== null) {
        Object.entries(data).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            console.log(`${key}: ${value.length} items`);
          } else {
            console.log(`${key}: ${typeof value}`);
          }
        });
      }
      break;
    default:
      console.log(data);
  }
}

// Parse query string into query object
function parseQuery(queryString) {
  try {
    // Try to parse as JSON first
    return JSON.parse(queryString);
  } catch (jsonError) {
    // If not valid JSON, try to convert JS object to JSON and parse
    try {
      // Convert JavaScript object literal to JSON format
      const jsonString = convertJSObjectToJSON(queryString);
      return JSON.parse(jsonString);
    } catch (conversionError) {
      // Last resort: use eval for complex expressions
      try {
        const result = eval(`(${queryString})`);
        if (typeof result === 'object' && result !== null) {
          return result;
        }
        throw new Error('Result is not an object');
      } catch (evalError) {
        console.error('Error: Invalid query format. Please provide a valid JSON object or JavaScript object literal.');
        console.error('Examples:');
        console.error('  JSON: \'{"todos": {}}\'');
        console.error('  JS Object: \'{todos: {}}\'');
        console.error('  With filters: \'{todos: {$: {where: {done: true}}}}\'');
        console.error('  Complex: \'{todoLists: {owner: {}, todos: {sublist: {}}}}\'');
        console.error('\nCommon mistakes:');
        console.error('  ❌ {$: {where: {"value"}}}        - Missing field name');
        console.error('  ✅ {$: {where: {field: "value"}}} - Correct format');
        console.error('  ❌ {$: {where: {field: value}}}   - Unquoted string value');
        console.error('  ✅ {$: {where: {field: "value"}}} - Quoted string value');
        console.error('\nOriginal error:', jsonError.message);
        process.exit(1);
      }
    }
  }
}

// Convert JavaScript object literal to JSON string
function convertJSObjectToJSON(jsString) {
  // Remove leading/trailing whitespace
  let processed = jsString.trim();
  
  // Ensure it starts and ends with braces
  if (!processed.startsWith('{') || !processed.endsWith('}')) {
    throw new Error('Query must be an object literal');
  }
  
  // Replace unquoted keys with quoted keys
  // This regex matches word characters followed by a colon (but not inside quotes)
  processed = processed.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
  
  // Handle special cases for $ keys (common in InstantDB queries)
  processed = processed.replace(/([{,]\s*)"?\$"?\s*:/g, '$1"$":');
  
  // Replace single quotes with double quotes (but be careful about nested quotes)
  processed = processed.replace(/'/g, '"');
  
  // Fix common JavaScript boolean/null values
  processed = processed.replace(/:\s*true\b/g, ': true');
  processed = processed.replace(/:\s*false\b/g, ': false');
  processed = processed.replace(/:\s*null\b/g, ': null');
  
  return processed;
}

// Query subcommand
program
  .command('query')
  .description('Execute an arbitrary query against the InstantDB database')
  .argument('<query>', 'Query object as JSON string or JavaScript object literal')
  .option('--app-id <id>', 'InstantDB App ID (or set INSTANT_APP_ID env var)')
  .option('--admin-token <token>', 'InstantDB Admin Token (or set INSTANT_APP_ADMIN_TOKEN env var)')
  .option('--impersonate-email <email>', 'Impersonate user by email')
  .option('--impersonate-id <id>', 'Impersonate user by ID')
  .option('--impersonate-token <token>', 'Impersonate user by token')
  .option('--guest', 'Run query as guest user')
  .option('--format <format>', 'Output format: json, table, count', 'json')
  .option('--pretty', 'Pretty print JSON output', false)
  .action(async (queryString, options) => {
    const db = initDB(options);
    const query = parseQuery(queryString);
    
    console.log('Executing query:', JSON.stringify(query, null, 2));
    
    try {
      let queryDb = db;
      
      // Handle user impersonation
      if (options.impersonateEmail) {
        console.log(`Impersonating user with email: ${options.impersonateEmail}`);
        queryDb = db.asUser({ email: options.impersonateEmail });
      } else if (options.impersonateId) {
        console.log(`Impersonating user with ID: ${options.impersonateId}`);
        queryDb = db.asUser({ id: options.impersonateId });
      } else if (options.impersonateToken) {
        console.log(`Impersonating user with token: ${options.impersonateToken}`);
        queryDb = db.asUser({ token: options.impersonateToken });
      } else if (options.guest) {
        console.log('Running query as guest user');
        queryDb = db.asUser({ guest: true });
      } else {
        console.log('Running query as admin (bypassing permissions)');
      }
      
      const startTime = Date.now();
      const result = await queryDb.query(query);
      const duration = Date.now() - startTime;
      
      console.log(`\nQuery completed in ${duration}ms`);
      console.log('Results:');
      displayResults(result, options.format);
      
    } catch (error) {
      console.error('Query failed:', error.message);
      if (error.body) {
        console.error('Error details:', error.body);
      }
      process.exit(1);
    }
  });

// User info subcommand
program
  .command('user')
  .description('Get user information')
  .argument('<identifier>', 'User email, ID, or refresh token')
  .option('--app-id <id>', 'InstantDB App ID (or set INSTANT_APP_ID env var)')
  .option('--admin-token <token>', 'InstantDB Admin Token (or set INSTANT_APP_ADMIN_TOKEN env var)')
  .option('--type <type>', 'Identifier type: email, id, refresh_token (auto-detected if not specified)')
  .action(async (identifier, options) => {
    const db = initDB(options);
    
    try {
      let userQuery;
      
      if (options.type === 'email' || (!options.type && identifier.includes('@'))) {
        userQuery = { email: identifier };
      } else if (options.type === 'id' || (!options.type && !identifier.includes('@') && !identifier.includes('_'))) {
        userQuery = { id: identifier };
      } else {
        userQuery = { refresh_token: identifier };
      }
      
      console.log('Looking up user:', userQuery);
      
      const user = await db.auth.getUser(userQuery);
      console.log('\nUser found:');
      console.log(JSON.stringify(user, null, 2));
      
    } catch (error) {
      console.error('User lookup failed:', error.message);
      process.exit(1);
    }
  });

// Presence subcommand
program
  .command('presence')
  .description('Get presence data for a room')
  .argument('<namespace>', 'Room namespace')
  .argument('<room-id>', 'Room ID')
  .option('--app-id <id>', 'InstantDB App ID (or set INSTANT_APP_ID env var)')
  .option('--admin-token <token>', 'InstantDB Admin Token (or set INSTANT_APP_ADMIN_TOKEN env var)')
  .action(async (namespace, roomId, options) => {
    const db = initDB(options);
    
    try {
      console.log(`Getting presence data for room: ${namespace}/${roomId}`);
      
      const presence = await db.rooms.getPresence(namespace, roomId);
      console.log('\nPresence data:');
      console.log(JSON.stringify(presence, null, 2));
      
      const users = Object.values(presence);
      console.log(`\nTotal users in room: ${users.length}`);
      
    } catch (error) {
      console.error('Failed to get presence data:', error.message);
      process.exit(1);
    }
  });

// Global options
program
  .option('--verbose', 'Enable verbose logging')
  .hook('preAction', (thisCommand, actionCommand) => {
    if (thisCommand.opts().verbose) {
      console.log('Verbose mode enabled');
    }
  });

// Parse command line arguments
program.parse();
