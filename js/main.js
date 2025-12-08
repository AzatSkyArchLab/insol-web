/**
 * ============================================
 * main.js
 * Точка входа приложения Insol Web
 * ============================================
 */

import { Coordinates } from './core/Coordinates.js';
import { MapEngine } from './core/MapEngine.js';
import { SceneManager } from './core/SceneManager.js';

// ============================================
// Инициализация
// ============================================

console.log('=== Insol Web v0.1 ===');

// Система координат (центр — Москва)
const coords = new Coordinates(55.7558, 37.6173);
window.coords = coords;

// Карта
const mapEngine = new MapEngine('map', {
    center: [37.6173, 55.7558],
    zoom: 16,
    pitch: 45
});
mapEngine.init();
window.mapEngine = mapEngine;

// 3D-сцена (после загрузки карты)
mapEngine.getMap().on('load', () => {
    const sceneManager = new SceneManager('three-canvas', mapEngine, coords);
    sceneManager.init();
    
    // Тестовый куб
    sceneManager.addTestCube(0, 0, 0, 30);
    
    window.sceneManager = sceneManager;
    console.log('[App] 3D-сцена готова');
});

console.log('[App] Инициализация завершена');