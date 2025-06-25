import { init } from '@instantdb/react';
import schema from '../instant.schema';

// ID for app: todo
const APP_ID = "3629fe62-7453-4610-9a5a-1143a87bcce1";

export const db = init({ 
  appId: APP_ID, 
  schema 
});

export type { AppSchema } from '../instant.schema';
