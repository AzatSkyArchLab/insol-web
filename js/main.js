/**
 * ============================================
 * main.js
 * Insol Web — Точка входа
 * ============================================
 * 
 * Вся логика вынесена в:
 * - app/App.js — главный класс
 * - app/AppState.js — состояние
 * - app/EventBus.js — события
 * - controllers/* — контроллеры по доменам
 */

import { App } from './app/App.js';

console.log('=== Insol Web v0.4 ===');

// Создание и инициализация приложения
const app = new App();
app.init();

// Глобальный доступ для отладки
window.app = app;
