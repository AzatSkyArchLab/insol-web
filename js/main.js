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
import { BuildingMesh } from './buildings/BuildingMesh.js';

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

// Генератор мешей
const buildingMesh = new BuildingMesh(coords);
window.buildingMesh = buildingMesh;

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
    
    // Загружаем здания
    const buildings = await buildingLoader.loadBuildingsAround(55.7558, 37.6173, 150);
    
    // Создаём 3D-меши
    const meshes = buildingMesh.createMeshes(buildings);
    
    // Добавляем на сцену
    const group = sceneManager.getBuildingsGroup();
    for (const mesh of meshes) {
        group.add(mesh);
    }
    
    console.log('[App] Здания добавлены на сцену');
});

console.log('[App] Инициализация завершена');