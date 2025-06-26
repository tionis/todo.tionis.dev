#!/bin/bash

# InstantDB Debug CLI Test Examples
# 
# Note: You need to set up your .env file with INSTANT_APP_ADMIN_TOKEN
# before running these examples.

echo "InstantDB Debug CLI Examples"
echo "============================"
echo ""

echo "1. Basic query - Get all todo lists:"
echo "npm run debug query '{\"todoLists\": {}}'"
echo ""

echo "2. Query with relationships - Get todo lists with their todos and owners:"
echo "npm run debug query '{\"todoLists\": {\"owner\": {}, \"todos\": {}, \"members\": {\"user\": {}}}}'"
echo ""

echo "3. Query with filters - Get only public todo lists:"
echo "npm run debug query '{\"todoLists\": {\"\$\": {\"where\": {\"permission\": \"public-read\"}}, \"todos\": {}}}'"
echo ""

echo "4. Impersonate a user - See what a specific user can access:"
echo "npm run debug query --impersonate-email 'user@example.com' '{\"todoLists\": {\"todos\": {}}}'"
echo ""

echo "5. Run as guest - See what guests can access:"
echo "npm run debug query --guest '{\"todoLists\": {\"todos\": {}}}'"
echo ""

echo "6. Get user information:"
echo "npm run debug user 'user@example.com'"
echo ""

echo "7. Check room presence:"
echo "npm run debug presence todoList 'my-list-slug'"
echo ""

echo "8. Count items with table format:"
echo "npm run debug query '{\"todoLists\": {}, \"todos\": {}, \"users\": {}}' --format count"
echo ""

echo "To run these examples:"
echo "1. Copy .env.example to .env"
echo "2. Add your INSTANT_APP_ADMIN_TOKEN to .env"
echo "3. Run any of the commands above"
