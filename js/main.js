/**
 * ============================================
 * main.js
 * Точка входа приложения Insol Web
 * ============================================
 */

import { Coordinates } from './core/Coordinates.js';
import { MapEngine } from './core/MapEngine.js';
import { SceneManager } from './core/SceneManager.js';
import { BuildingLoader } from './buildings/BuildingLoader.js';

// ============================================
// Инициализация
// ============================================

console.log('=== Insol Web v0.1 ===');

// Система координат (центр — Москва)
const coords = new Coordinates(55.7558, 37.6173);
window.coords = coords;

// Загрузчик зданий
const buildingLoader = new BuildingLoader();
window.buildingLoader = buildingLoader;

// Карта
const mapEngine = new MapEngine('map', {
    center: [37.6173, 55.7558],
    zoom: 16,
    pitch: 45
});
mapEngine.init();
window.mapEngine = mapEngine;

// 3D-сцена
mapEngine.getMap().on('load', async () => {
    const sceneManager = new SceneManager('three-canvas', mapEngine, coords);
    sceneManager.init();
    window.sceneManager = sceneManager;
    
    // Загружаем здания вокруг центра (радиус 150м)
    const buildings = await buildingLoader.loadBuildingsAround(55.7558, 37.6173, 150);
    console.log('[App] Первое здание:', buildings[0]);
    
    console.log('[App] 3D-сцена готова');
});

console.log('[App] Инициализация завершена');