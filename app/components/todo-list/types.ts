export interface Todo {
  id: string;
  text: string;
  done: boolean;
  /** Restocking that isn't urgent ("Nachfüllen"). */
  later?: boolean;
  order: number;
  sublist?: Sublist | null;
  [key: string]: any;
}

export interface Sublist {
  id: string;
  name: string;
  /** Legacy: lists from before category paths kept the parent here; see lib/categoryTree.ts. */
  group?: string | null;
  order: number;
  todos: Todo[];
  [key: string]: any;
}

export interface TodoList {
  id: string;
  name: string;
  slug: string;
  permission: string;
  todos: Todo[];
  sublists: Sublist[];
  members: any[];
  groupGrants: any[];
  pins: any[];
  todoClassifications: any[];
  [key: string]: any;
}
