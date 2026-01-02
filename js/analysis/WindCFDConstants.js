/**
 * WindCFDConstants.js
 * Константы, цветовые шкалы, критерии комфорта
 */

// Цветовая шкала для абсолютных скоростей (м/с) - как в Paraview
export const COLOR_SCALE = [
    { t: 0.0, color: [59, 76, 192] },    // Синий (низкая скорость)
    { t: 0.15, color: [98, 130, 234] },
    { t: 0.3, color: [141, 176, 254] },
    { t: 0.4, color: [184, 208, 249] },
    { t: 0.5, color: [221, 221, 221] },  // Белый/серый (средняя)
    { t: 0.6, color: [245, 196, 173] },
    { t: 0.7, color: [244, 154, 123] },
    { t: 0.85, color: [222, 96, 77] },
    { t: 1.0, color: [180, 4, 38] }      // Красный (высокая скорость)
];

// Lawson LDDC Criteria (2001) - пороги для 5% превышения
export const LAWSON_CRITERIA = {
    sitting_long:  { threshold: 2.5, color: [34, 139, 34],   label: 'A - Длит. сидение', desc: 'Парки, кафе' },
    sitting_short: { threshold: 4.0, color: [144, 238, 144], label: 'B - Корот. сидение', desc: 'Скамейки' },
    standing:      { threshold: 6.0, color: [255, 255, 0],   label: 'C - Стояние', desc: 'Остановки' },
    walking:       { threshold: 8.0, color: [255, 165, 0],   label: 'D - Прогулка', desc: 'Тротуары' },
    uncomfortable: { threshold: 10.0, color: [255, 0, 0],    label: 'E - Некомфортно', desc: 'Проходы' },
    dangerous:     { threshold: Infinity, color: [139, 0, 0], label: 'S - Опасно', desc: 'Недопустимо' }
};

// NEN 8100 (Dutch standard) - вероятность P(U > 5 м/с)
export const NEN8100_CRITERIA = {
    A: { maxExceed: 2.5,  color: [34, 139, 34],   label: 'A - Отлично', desc: 'Длит. сидение' },
    B: { maxExceed: 5.0,  color: [144, 238, 144], label: 'B - Хорошо', desc: 'Корот. сидение' },
    C: { maxExceed: 10.0, color: [255, 255, 0],   label: 'C - Умеренно', desc: 'Прогулки' },
    D: { maxExceed: 20.0, color: [255, 165, 0],   label: 'D - Плохо', desc: 'Только проходы' },
    E: { maxExceed: Infinity, color: [255, 0, 0], label: 'E - Некомфортно', desc: 'Недопустимо' }
};

// Lawson пороги для итеративной проверки
export const LAWSON_THRESHOLDS = [
    { key: 'sitting_long', threshold: 2.5 },
    { key: 'sitting_short', threshold: 4.0 },
    { key: 'standing', threshold: 6.0 },
    { key: 'walking', threshold: 8.0 },
    { key: 'uncomfortable', threshold: 10.0 },
    { key: 'dangerous', threshold: Infinity }
];

// Направления ветра
export const WIND_DIRECTIONS = {
    names: ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'],
    angles: [0, 45, 90, 135, 180, 225, 270, 315]
};

// Дефолтные настройки CFD (COST 732 / AIJ Guidelines)
export const DEFAULT_DOMAIN_SETTINGS = {
    // Домен (множители от H - высоты самого высокого здания)
    inletFactor: 5,      // 5H до inlet (COST 732 стандарт, min 3)
    outletFactor: 8,     // 8H до outlet (компромисс, идеал 10-15H, min 6)
    lateralFactor: 2.5,  // 2.5H по бокам (можно 5H для точности)
    heightFactor: 5,     // 5H высота домена
    // Сетка
    cellSize: 5,         // Размер базовой ячейки (м)
    refinementMin: 1,    // Мин. уровень рафинирования (0-3)
    refinementMax: 2,    // Макс. уровень (1-4), каждый /2
    maxCells: 3,         // Макс. ячеек (миллионы)
    // Расчёт
    iterations: 400      // Итерации SIMPLE 
};

// Дефолтные настройки комфорта
export const DEFAULT_COMFORT_SETTINGS = {
    standard: 'lawson',  // 'lawson' | 'nen8100'
    speedSource: 'gem',  // 'cfd' | 'gem' | 'p95' | 'max'
    showComfort: false
};

// Дефолтные настройки визуализации
export const DEFAULT_VISUALIZATION_SETTINGS = {
    displayMode: 'gradient', // 'gradient' | 'vectors' | 'both'
    vectorDensity: 60,
    vectorScale: 3,
    sliceHeight: 1.75  // метров (уровень пешехода)
};

// Дефолтные настройки анимации потоков
export const DEFAULT_FLOW_SETTINGS = {
    particleCount: 800,
    speedMultiplier: 5.0,
    fadeLength: 50,
    particleLifetime: 10.0,
    colorBySpeed: true
};