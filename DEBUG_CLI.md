# InstantDB Debug CLI

A command-line tool for debugging InstantDB databases using the admin SDK.

## Installation

First, install the required dependencies:

```bash
npm install
```

## Setup

You'll need your InstantDB App ID and Admin Token. You can provide these in two ways:

### Option 1: Environment Variables (Recommended)

Create a `.env` file in the project root:

```env
INSTANT_APP_ID=your_app_id_here
INSTANT_APP_ADMIN_TOKEN=your_admin_token_here
```

### Option 2: Command Line Options

Pass the credentials directly via command line flags:

```bash
npm run debug query --app-id your_app_id --admin-token your_admin_token '{"todos": {}}'
```

## Usage

### Query Command

Execute arbitrary queries against your InstantDB database:

```bash
# Basic query
npm run debug query '{"todos": {}}'

# Query with filters
npm run debug query '{"todos": {"$": {"where": {"done": true}}}}'

# Query multiple entities
npm run debug query '{"todos": {}, "users": {}}'
```

#### User Impersonation

Run queries with user permissions instead of admin privileges:

```bash
# Impersonate by email
npm run debug query --impersonate-email user@example.com '{"todos": {}}'

# Impersonate by user ID
npm run debug query --impersonate-id user_123 '{"todos": {}}'

# Impersonate by token
npm run debug query --impersonate-token refresh_token_here '{"todos": {}}'

# Run as guest user
npm run debug query --guest '{"todos": {}}'
```

#### Output Formats

Choose different output formats:

```bash
# JSON format (default)
npm run debug query '{"todos": {}}' --format json

# Table format
npm run debug query '{"todos": {}}' --format table

# Count format (shows item counts)
npm run debug query '{"todos": {}}' --format count
```

### User Command

Look up user information:

```bash
# By email
npm run debug user user@example.com

# By user ID
npm run debug user user_123

# By refresh token
npm run debug user refresh_token_here

# Specify identifier type explicitly
npm run debug user user@example.com --type email
```

### Presence Command

Get presence data for rooms:

```bash
# Get presence for a specific room
npm run debug presence chat room-123
```

## Examples

### Debug Todo Permissions

Check what a specific user can see:

```bash
# See all todos as admin
npm run debug query '{"todoLists": {"todos": {}, "members": {"user": {}}}}'

# See what a specific user can access
npm run debug query --impersonate-email user@example.com '{"todoLists": {"todos": {}, "members": {"user": {}}}}'
```

### Find Orphaned Data

```bash
# Find todos without a parent list
npm run debug query '{"todos": {"$": {"where": {"list": null}}}}'

# Count items by type
npm run debug query '{"todos": {}, "todoLists": {}, "users": {}}' --format count
```

### Monitor Active Users

```bash
# Check who's online in a todo list
npm run debug presence todoList my-list-slug
```

## Query Syntax

The query syntax follows InstantDB's InstaQL format. Here are some common patterns:

### Basic Queries

```javascript
// Get all todos
{"todos": {}}

// Get todos with related data
{"todos": {"list": {}, "sublist": {}}}

// Get specific fields only
{"todos": {"$": {"select": ["text", "done"]}}}
```

### Filtering

```javascript
// Filter by field value
{"todos": {"$": {"where": {"done": true}}}}

// Filter by relationship
{"todoLists": {"$": {"where": {"owner": "user_123"}}}}

// Multiple conditions
{"todos": {"$": {"where": {"done": false, "text": {"$contains": "urgent"}}}}}
```

### Sorting and Limiting

```javascript
// Sort by field
{"todos": {"$": {"order": {"createdAt": "desc"}}}}

// Limit results
{"todos": {"$": {"limit": 10}}}

// Combine sorting and limiting
{"todos": {"$": {"order": {"createdAt": "desc"}, "limit": 5}}}
```

## Troubleshooting

### Common Issues

1. **Invalid query format**: Make sure your query is valid JSON or JavaScript object literal
2. **Permission denied**: Check if the user you're impersonating has the right permissions
3. **User not found**: Verify the user identifier (email, ID, or token) is correct

### Verbose Mode

Enable verbose logging for debugging:

```bash
npm run debug query '{"todos": {}}' --verbose
```

## Security Notes

- Never commit your `.env` file containing admin tokens to version control
- The admin token bypasses all permissions when not using impersonation
- Be careful when using `eval()` for query parsing in production environments

## Schema Support

If you have an `instant.schema.ts` file in your project root, the CLI will attempt to use it for type safety. For full schema support, consider compiling your TypeScript schema to JavaScript first.
