/**
 * WindCFDUtils.js
 * Утилиты: цвета, интерполяция, экспорт, генерация UUID
 */

import { COLOR_SCALE } from './WindCFDConstants.js';

/**
 * Генерация UUID v4
 */
export function generateSessionId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * Получение или создание session ID из localStorage
 */
export function getOrCreateSessionId() {
    let sessionId = localStorage.getItem('cfd_session_id');
    if (!sessionId) {
        sessionId = generateSessionId();
        localStorage.setItem('cfd_session_id', sessionId);
    }
    return sessionId;
}

/**
 * Получение цвета для скорости по градиентной шкале
 */
export function getColorForSpeed(speed, speedRange, colorScale = COLOR_SCALE) {
    const { min, max } = speedRange;
    
    // Нормализуем скорость в диапазон 0-1
    let t = (speed - min) / (max - min);
    t = Math.max(0, Math.min(1, t));
    
    // Находим два соседних цвета для интерполяции
    let i = 0;
    while (i < colorScale.length - 1 && colorScale[i + 1].t < t) {
        i++;
    }
    
    if (i >= colorScale.length - 1) {
        return colorScale[colorScale.length - 1].color;
    }
    
    const c1 = colorScale[i];
    const c2 = colorScale[i + 1];
    
    // Линейная интерполяция между двумя цветами
    const localT = (t - c1.t) / (c2.t - c1.t);
    
    return [
        Math.round(c1.color[0] + (c2.color[0] - c1.color[0]) * localT),
        Math.round(c1.color[1] + (c2.color[1] - c1.color[1]) * localT),
        Math.round(c1.color[2] + (c2.color[2] - c1.color[2]) * localT)
    ];
}

/**
 * Бикубическая интерполяция для сглаживания данных
 */
export function bicubicInterpolate(grid, gx, gy, nx, ny) {
    const cubicInterp = (p0, p1, p2, p3, t) => {
        const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
        const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
        const c = -0.5 * p0 + 0.5 * p2;
        const d = p1;
        return a * t * t * t + b * t * t + c * t + d;
    };
    
    const getVal = (ix, iy) => {
        ix = Math.max(0, Math.min(nx - 1, ix));
        iy = Math.max(0, Math.min(ny - 1, iy));
        return grid[iy]?.[ix] ?? 0;
    };
    
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    
    // 4x4 окрестность
    const rows = [];
    for (let dy = -1; dy <= 2; dy++) {
        const p0 = getVal(ix - 1, iy + dy);
        const p1 = getVal(ix, iy + dy);
        const p2 = getVal(ix + 1, iy + dy);
        const p3 = getVal(ix + 2, iy + dy);
        rows.push(cubicInterp(p0, p1, p2, p3, fx));
    }
    return Math.max(0, cubicInterp(rows[0], rows[1], rows[2], rows[3], fy));
}

/**
 * Экспорт данных в JSON файл
 */
export function exportToJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Sleep функция
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Конвертация зданий в GeoJSON
 */
export function buildingsToGeoJSON(buildings, THREE) {
    const features = [];
    
    buildings.forEach(mesh => {
        const height = mesh.userData.properties?.height || 9;
        const id = mesh.userData.id || 'unknown';
        
        let coords = [];
        
        if (mesh.userData.basePoints) {
            coords = mesh.userData.basePoints.map(p => [p.x, p.y]);
            coords.push(coords[0]);
        } else {
            const bbox = new THREE.Box3().setFromObject(mesh);
            coords = [
                [bbox.min.x, bbox.min.y],
                [bbox.max.x, bbox.min.y],
                [bbox.max.x, bbox.max.y],
                [bbox.min.x, bbox.max.y],
                [bbox.min.x, bbox.min.y]
            ];
        }
        
        features.push({
            type: 'Feature',
            properties: { id, height },
            geometry: { type: 'Polygon', coordinates: [coords] }
        });
    });
    
    return { type: 'FeatureCollection', features };
}

/**
 * Вычисление диапазона скоростей из grid данных
 */
export function calculateSpeedRange(gridValues) {
    let maxSpeed = 0;
    const ny = gridValues.length;
    
    for (let iy = 0; iy < ny; iy++) {
        const row = gridValues[iy];
        if (!row) continue;
        const nx = row.length;
        for (let ix = 0; ix < nx; ix++) {
            const v = row[ix] ?? 0;
            if (v > maxSpeed) maxSpeed = v;
        }
    }
    
    return { min: 0, max: maxSpeed > 0.1 ? maxSpeed : 5 };
}

/**
 * Создание tooltip элемента
 */
export function showTooltip(x, y, content, id = 'wcfd-tooltip') {
    let tooltip = document.getElementById(id);
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = id;
        tooltip.style.cssText = `
            position: fixed;
            background: rgba(0,0,0,0.85);
            color: white;
            padding: 10px 14px;
            border-radius: 8px;
            font-size: 14px;
            pointer-events: none;
            z-index: 10000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(tooltip);
    }
    tooltip.innerHTML = content;
    tooltip.style.left = (x + 15) + 'px';
    tooltip.style.top = (y + 15) + 'px';
    tooltip.style.display = 'block';
    
    return tooltip;
}

/**
 * Скрытие tooltip
 */
export function hideTooltip(id = 'wcfd-tooltip') {
    const tooltip = document.getElementById(id);
    if (tooltip) {
        tooltip.style.display = 'none';
    }
}