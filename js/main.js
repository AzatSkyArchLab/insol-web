/**
 * ============================================
 * main.js
 * Точка входа приложения Insol Web
 * ============================================
 */

import { Coordinates } from './core/Coordinates.js';

// ============================================
// Инициализация
// ============================================

console.log('=== Insol Web v0.1 ===');

// Создаём систему координат (центр — Москва)
const coords = new Coordinates(55.7558, 37.6173);

// Делаем доступным глобально для отладки
window.coords = coords;

// ============================================
// Тесты координат (запусти в консоли браузера)
// ============================================

function runCoordinatesTest() {
    console.log('\n--- Тест Coordinates ---');
    
    // Тест 1: Конвертация WGS84 → метры
    const testPoint = { lat: 55.7600, lon: 37.6200 };
    const meters = coords.wgs84ToMeters(testPoint.lat, testPoint.lon);
    console.log(`WGS84 (${testPoint.lat}, ${testPoint.lon}) → Метры:`, meters);
    
    // Тест 2: Обратная конвертация
    const backToWgs84 = coords.metersToWgs84(meters.x, meters.y);
    console.log(`Метры (${meters.x.toFixed(2)}, ${meters.y.toFixed(2)}) → WGS84:`, backToWgs84);
    
    // Тест 3: Расстояние
    const dist = coords.distanceWgs84(55.7558, 37.6173, 55.7600, 37.6200);
    console.log(`Расстояние от центра: ${dist.toFixed(2)} м`);
    
    // Тест 4: Проверка точности (должно быть ~0)
    const error = coords.distanceWgs84(
        testPoint.lat, testPoint.lon,
        backToWgs84.lat, backToWgs84.lon
    );
    console.log(`Ошибка конвертации: ${error.toFixed(6)} м`);
    
    console.log('--- Тест завершён ---\n');
}

// Экспортируем функцию теста
window.runCoordinatesTest = runCoordinatesTest;

// Автоматически запускаем тест
runCoordinatesTest();
