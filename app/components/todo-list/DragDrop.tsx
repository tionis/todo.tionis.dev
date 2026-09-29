"use client";

import { useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragOverlay, DragStartEvent, DragEndEvent, DragOverEvent, useDroppable } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { db } from '../../../lib/db';
import { createClassificationTransaction } from '../../../lib/todoTransactions';
import { useToast } from '../Toast';
import type { Todo, Sublist, TodoList } from './types';
import { ActionBar, AddSublistForm, SublistSection } from './SublistSection';
import { TodoForm, TodoListComponent } from './TodoItems';

export function DroppableUncategorizedSection({
  visibleTodos,
  todosWithoutSublist,
  completedUncategorizedTodos,
  showCompletedUncategorized,
  setShowCompletedUncategorized,
  canWrite,
  toggleTodo,
  deleteTodo,
  todoList
}: {
  visibleTodos: Todo[];
  todosWithoutSublist: Todo[];
  completedUncategorizedTodos: Todo[];
  showCompletedUncategorized: boolean;
  setShowCompletedUncategorized: (show: boolean) => void;
  canWrite: boolean;
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
  todoList: TodoList;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'sublist-uncategorized',
  });

  return (
    <div>
      <div 
        ref={setNodeRef}
        className={`bg-gray-50 dark:bg-gray-700 px-3 py-2 text-sm font-medium border-b border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white transition-colors ${isOver ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600' : ''}`}
      >
        Uncategorized ({todosWithoutSublist.filter(t => !t.done).length}/{todosWithoutSublist.length})
        {canWrite && isOver && <span className="text-xs text-blue-600 dark:text-blue-400 ml-2">(Drop here)</span>}
        {canWrite && !isOver && <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">(Drop todos here)</span>}
      </div>
      {visibleTodos.length > 0 && (
        <TodoListComponent todos={visibleTodos} canWrite={canWrite} toggleTodo={toggleTodo} deleteTodo={deleteTodo} sublistId={undefined} />
      )}
      {todoList.hideCompleted && !showCompletedUncategorized && completedUncategorizedTodos.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-300 dark:border-gray-600">
          <button
            onClick={() => setShowCompletedUncategorized(true)}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center space-x-1"
          >
            <span>▼</span>
            <span>Show {completedUncategorizedTodos.length} completed item{completedUncategorizedTodos.length !== 1 ? 's' : ''}</span>
          </button>
        </div>
      )}
      {todoList.hideCompleted && showCompletedUncategorized && completedUncategorizedTodos.length > 0 && (
        <div>
          <div className="px-3 py-2 border-b border-gray-300 dark:border-gray-600">
            <button
              onClick={() => setShowCompletedUncategorized(false)}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center space-x-1"
            >
              <span>▲</span>
              <span>Hide completed items</span>
            </button>
          </div>
          <TodoListComponent todos={completedUncategorizedTodos} canWrite={canWrite} toggleTodo={toggleTodo} deleteTodo={deleteTodo} sublistId={undefined} />
        </div>
      )}
    </div>
  );
}

// Global Drag and Drop Wrapper Component
export function GlobalDragWrapper({
  todoList,
  sublists,
  canWrite,
  isOwner,
  toggleTodo,
  deleteTodo,
  visibleTodos,
  todosWithoutSublist,
  completedUncategorizedTodos,
  showCompletedUncategorized,
  setShowCompletedUncategorized,
  deleteCompleted
}: {
  todoList: TodoList;
  sublists: Sublist[];
  canWrite: boolean;
  isOwner: boolean;
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
  visibleTodos: Todo[];
  todosWithoutSublist: Todo[];
  completedUncategorizedTodos: Todo[];
  showCompletedUncategorized: boolean;
  setShowCompletedUncategorized: (show: boolean) => void;
  deleteCompleted: (todos: Todo[]) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { addToast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    // Handle drag over between different containers (sublists)
    const { active, over } = event;
    
    if (!over) return;
    
    const activeId = active.id as string;
    const overId = over.id as string;
    
    // Find the active todo
    const activeTodo = todoList.todos.find(t => t.id === activeId);
    if (!activeTodo) return;
    
    // Check if we're dropping over a sublist header or todo in a different sublist
    const overTodo = todoList.todos.find(t => t.id === overId);
    const currentSublistId = activeTodo.sublist?.id;
    const targetSublistId = overTodo?.sublist?.id;
    
    // If moving between different sublists, update immediately for visual feedback
    if (currentSublistId !== targetSublistId) {
      // This will be handled in handleDragEnd for the actual database update
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) {
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;
    
    // Find the active todo
    const activeTodo = todoList.todos.find(t => t.id === activeId);
    if (!activeTodo) return;
    
    try {
      // Check if we're dropping over a sublist header (drop zone)
      if (overId.startsWith('sublist-')) {
        const targetSublistId = overId.replace('sublist-', '');
        
        // Move todo to different sublist
        let updateTx = db.tx.todos[activeId].update({
          updatedAt: new Date().toISOString()
        });
        
        if (targetSublistId === 'uncategorized') {
          // Move to uncategorized (remove sublist link)
          updateTx = updateTx.unlink({ sublist: activeTodo.sublist?.id });
        } else {
          // Move to specific sublist
          updateTx = updateTx.link({ sublist: targetSublistId });
        }
        
        const transactions: any[] = [updateTx];
        if (targetSublistId !== 'uncategorized') {
          if (activeTodo.sublist?.id && activeTodo.sublist.id !== targetSublistId) {
            transactions.push(createClassificationTransaction(todoList.id, activeTodo.sublist.id, activeTodo.text, "negative"));
          }
          transactions.push(createClassificationTransaction(todoList.id, targetSublistId, activeTodo.text, "manual-move"));
        }

        await db.transact(transactions);
        return;
      }
      
      // Find the over todo
      const overTodo = todoList.todos.find(t => t.id === overId);
      if (!overTodo) return;
      
      const currentSublistId = activeTodo.sublist?.id;
      const targetSublistId = overTodo.sublist?.id;
      
      // If moving between different sublists
      if (currentSublistId !== targetSublistId) {
        let updateTx = db.tx.todos[activeId].update({
          updatedAt: new Date().toISOString()
        });
        
        if (targetSublistId) {
          updateTx = updateTx.link({ sublist: targetSublistId });
        } else {
          updateTx = updateTx.unlink({ sublist: currentSublistId });
        }
        
        const transactions: any[] = [updateTx];
        if (targetSublistId) {
          if (currentSublistId && currentSublistId !== targetSublistId) {
            transactions.push(createClassificationTransaction(todoList.id, currentSublistId, activeTodo.text, "negative"));
          }
          transactions.push(createClassificationTransaction(todoList.id, targetSublistId, activeTodo.text, "manual-move"));
        }

        await db.transact(transactions);
        return;
      }
      
      // If reordering within the same sublist
      const todosInSameSublist = todoList.todos.filter(t => 
        (t.sublist?.id || null) === (currentSublistId || null)
      ).sort((a, b) => (a.order || 0) - (b.order || 0));
      
      const oldIndex = todosInSameSublist.findIndex(t => t.id === activeId);
      const newIndex = todosInSameSublist.findIndex(t => t.id === overId);
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const reorderedTodos = arrayMove(todosInSameSublist, oldIndex, newIndex);
        
        const updates = reorderedTodos.map((todo, index) => 
          db.tx.todos[todo.id].update({ 
            order: index + 1,
            updatedAt: new Date().toISOString()
          })
        );

        await db.transact(updates);
      }
    } catch (err) {
      console.error("Failed to move todo:", err);
      addToast("Failed to move todo. Please try again.", "error");
    }
  };

  const activeTodo = activeId ? todoList.todos.find(todo => todo.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="border border-gray-300 dark:border-gray-600 max-w-2xl w-full mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-sm">
        {canWrite && <TodoForm todoList={todoList} addToast={addToast} />}
        
        {/* Sublists */}
        {sublists.map(sublist => (
          <SublistSection 
            key={sublist.id} 
            sublist={sublist} 
            todoList={todoList}
            canWrite={canWrite}
            isOwner={isOwner}
            toggleTodo={toggleTodo}
            deleteTodo={deleteTodo}
          />
        ))}

        {/* Add new sublist button */}
        {canWrite && <AddSublistForm todoList={todoList} />}
        
        {/* Todos without sublist */}
        {(visibleTodos.length > 0 || (todosWithoutSublist.length > 0 && todoList.hideCompleted)) && (
          <DroppableUncategorizedSection
            visibleTodos={visibleTodos}
            todosWithoutSublist={todosWithoutSublist}
            completedUncategorizedTodos={completedUncategorizedTodos}
            showCompletedUncategorized={showCompletedUncategorized}
            setShowCompletedUncategorized={setShowCompletedUncategorized}
            canWrite={canWrite}
            toggleTodo={toggleTodo}
            deleteTodo={deleteTodo}
            todoList={todoList}
          />
        )}
        
        <ActionBar todoList={todoList} canWrite={canWrite} deleteCompleted={deleteCompleted} />
      </div>
      
      <DragOverlay>
        {activeTodo ? (
          <div className="bg-white dark:bg-gray-800 shadow-lg rounded border p-2">
            <span className={`${activeTodo.done ? 'line-through text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>
              {activeTodo.text}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// Helper Components
