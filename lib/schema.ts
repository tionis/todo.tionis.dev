import { co, z, Group, InstanceOfSchema, zodSchemaToCoSchema } from "jazz-tools";

// Sublist/category within a todo list
export const Sublist = co.map({
  name: z.string(),
  order: z.number(),
  createdAt: z.string(),
});
export type Sublist = co.loaded<typeof Sublist>;

// Individual todo item
export const Todo = co.map({
  text: z.string(),
  done: z.boolean(),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  // Reference to sublist (optional - todo may not belong to any sublist)
  sublist: Sublist.optional(),
});
export type Todo = co.loaded<typeof Todo>;

// List of todos
export const ListOfTodos = co.list(Todo);
export type ListOfTodos = co.loaded<typeof ListOfTodos>;

// List of sublists
export const ListOfSublists = co.list(Sublist);
export type ListOfSublists = co.loaded<typeof ListOfSublists>;

// Main todo list
export const TodoList = co.map({
  name: z.string(),
  hideCompleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  // Nested collections
  todos: ListOfTodos,
  sublists: ListOfSublists,
});
export type TodoList = co.loaded<typeof TodoList>;

// List of todo lists for account root
export const ListOfTodoLists = co.list(TodoList);
export type ListOfTodoLists = co.loaded<typeof ListOfTodoLists>;

// Account root - stores user's data
export const TodoAccountRoot = co.map({
  todoLists: ListOfTodoLists,
});
export type TodoAccountRoot = co.loaded<typeof TodoAccountRoot>;

// Account schema using functional pattern with migration
export const TodoAccount = co
  .account({
    profile: co.profile(),
    root: TodoAccountRoot,
  })
  .withMigration((account) => {
    // Initialize account root on first creation
    if (account.root === undefined) {
      const rootGroup = Group.create({ owner: account });
      rootGroup.addMember(account, "admin");
      account.root = TodoAccountRoot.create(
        {
          todoLists: ListOfTodoLists.create([], { owner: rootGroup }),
        },
        { owner: rootGroup }
      );
    }
  });

// Type helper for the TodoAccount instance
export type TodoAccountInstance = InstanceOfSchema<typeof TodoAccount>;

// Convert to CoValue class for provider compatibility
export const TodoAccountClass = zodSchemaToCoSchema(TodoAccount);
