# InstantDB Debug CLI

A command-line tool for debugging InstantDB databases using the admin SDK.

## Installation

Install dependencies:
```bash
npm install
```

## Environment Setup

The CLI automatically loads environment variables from a `.env` file in the current directory. 

Required environment variables:
- `INSTANT_APP_ID` - Your InstantDB App ID (already configured)
- `INSTANT_APP_ADMIN_TOKEN` - Your InstantDB Admin Token (get this from your InstantDB dashboard)

Add your admin token to the `.env` file:
```bash
# In .env file
INSTANT_APP_ADMIN_TOKEN=your_admin_token_here
```

Or pass credentials directly via command line options:
```bash
node debug-cli.js query '{"todos": {}}' --app-id your-app-id --admin-token your-admin-token
```

**Note:** Environment variables take precedence over command line options.

## Usage

### Query Command

Execute arbitrary queries against your InstantDB database:

```bash
# Basic query (JSON format)
node debug-cli.js query '{"todos": {}}'

# Basic query (JavaScript object format - unquoted keys)
node debug-cli.js query '{todos: {}}'

# Query with filters (both formats work)
node debug-cli.js query '{"todos": {"$": {"where": {"done": true}}}}'
node debug-cli.js query '{todos: {$: {where: {done: true}}}}'

# Complex query with relations
node debug-cli.js query '{todoLists: {owner: {}, todos: {}, members: {user: {}}}}'

# Impersonate a user by email
node debug-cli.js query '{todos: {}}' --impersonate-email user@example.com

# Run as guest user
node debug-cli.js query '{todos: {}}' --guest

# Different output formats
node debug-cli.js query '{todos: {}}' --format table
node debug-cli.js query '{todos: {}}' --format count
```

**Query Format Support:**
- ✅ JSON format: `'{"todos": {}}'`
- ✅ JavaScript object literals: `'{todos: {}}'`
- ✅ Mixed quotes and boolean values: `'{todos: {$: {where: {done: false}}}}'`
- ✅ Special keys like `$`: `'{todos: {$: {limit: 10}}}'`

### User Command

Look up user information:

```bash
# By email
node debug-cli.js user user@example.com

# By user ID
node debug-cli.js user user-id-123

# By refresh token
node debug-cli.js user refresh_token_abc123
```

### Presence Command

Get presence data for a room:

```bash
node debug-cli.js presence todoList my-todo-list-slug
```

## Query Examples

### Basic Entity Queries
```bash
# Get all todos (JSON format)
node debug-cli.js query '{"todos": {}}'

# Get all todos (JavaScript object format)
node debug-cli.js query '{todos: {}}'

# Get todos with specific status
node debug-cli.js query '{todos: {$: {where: {done: false}}}}'

# Get todos with relations
node debug-cli.js query '{todos: {sublist: {}}}'
```

### Advanced Queries
```bash
# Get todo lists with all relations
node debug-cli.js query '{todoLists: {owner: {}, todos: {}, sublists: {todos: {}}, members: {user: {}}}}'

# Filter by permission level
node debug-cli.js query '{todoLists: {$: {where: {permission: "public-read"}}, todos: {}}}'

# Query with user impersonation to test permissions
node debug-cli.js query '{todoLists: {}}' --impersonate-email test@example.com

# Count items with table display
node debug-cli.js query '{todoLists: {}, todos: {}, users: {}}' --format count
```

### Query Syntax Examples
```bash
# Both of these are equivalent:
node debug-cli.js query '{"todos": {"$": {"where": {"done": true}}}}'  # JSON
node debug-cli.js query '{todos: {$: {where: {done: true}}}}'           # JS Object

# Complex nested queries
node debug-cli.js query '{
  todoLists: {
    $: {where: {hideCompleted: false}},
    owner: {},
    todos: {
      $: {where: {done: false}},
      sublist: {}
    }
  }
}'
```

## Security Notes

- Never commit your admin token to version control
- The admin token gives full access to your database
- Use user impersonation to test permission rules
- The CLI bypasses all permissions when running as admin (default)

## Troubleshooting

### Common Issues

1. **"App ID is required"** - Make sure `INSTANT_APP_ID` is set in your `.env` file
2. **"Admin token is required"** - Add `INSTANT_APP_ADMIN_TOKEN` to your `.env` file
3. **"Invalid query format"** - Ensure your query is valid JSON or JavaScript object literal
4. **Permission errors** - Try running with `--guest` or user impersonation to test permissions

### Debug Mode

Use the `--verbose` flag for detailed logging:
```bash
node debug-cli.js query '{"todos": {}}' --verbose
```
