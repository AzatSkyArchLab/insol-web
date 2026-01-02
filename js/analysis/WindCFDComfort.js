/**
 * WindCFDComfort.js
 * Анализ ветрового комфорта (Lawson LDDC / NEN 8100)
 */

import { LAWSON_CRITERIA, NEN8100_CRITERIA, LAWSON_THRESHOLDS } from './WindCFDConstants.js';

/**
 * Класс для анализа ветрового комфорта
 */
export class WindComfortAnalyzer {
    constructor(sceneManager, THREE) {
        this.sceneManager = sceneManager;
        this.THREE = THREE;
        
        this.comfortOverlay = null;
        this.comfortData = null;
        
        this.settings = {
            standard: 'lawson',  // 'lawson' | 'nen8100'
            speedSource: 'gem',  // 'cfd' | 'gem' | 'p95' | 'max'
            showComfort: false
        };
    }
    
    /**
     * Установка настроек
     */
    setSettings(settings) {
        this.settings = { ...this.settings, ...settings };
    }
    
    /**
     * Главный метод расчёта ветрового комфорта
     * 
     * МЕТОДОЛОГИЯ (Amplification Factor):
     * 1. K = V_cfd / V_input — коэффициент усиления
     * 2. V_real = K × V_climate — реальная скорость (P95 из EPW)
     * 3. P(exceed) = Σ(freq × I(V_real > threshold))
     */
    calculate(results, epwData, sliceHeight) {
        console.log('[Comfort] Calculating wind comfort with amplification factor method...');
        
        // Проверяем наличие данных
        const validResults = Object.entries(results).filter(
            ([_, r]) => r && r.data && r.data.grid
        );
        
        if (validResults.length < 4) {
            throw new Error(`Недостаточно данных. Рассчитано ${validResults.length}/8 направлений. Минимум 4.`);
        }
        
        if (!epwData?.sectors) {
            throw new Error('Нет данных EPW. Загрузите файл EPW.');
        }
        
        // Берём первый результат как reference для сетки
        const refResult = validResults[0][1].data;
        const grid = refResult.grid;
        const nx = grid.nx;
        const ny = grid.ny;
        
        const speedSource = this.settings.speedSource || 'p95';
        console.log(`[Comfort] Speed source: ${speedSource}`);
        
        // Создаём массивы для комфорта
        const comfortGrid = Array(ny).fill(null).map(() => Array(nx).fill(0));
        const categoryGrid = Array(ny).fill(null).map(() => Array(nx).fill('A'));
        const exceedGrid = Array(ny).fill(null).map(() => Array(nx).fill(0));
        
        // Считаем общую частоту рассчитанных направлений
        let totalCoverage = 0;
        for (const [angleStr, _] of validResults) {
            const angle = parseInt(angleStr);
            const sector = epwData.sectors.find(s => s.angle === angle);
            if (sector) totalCoverage += sector.frequency;
        }
        console.log(`[Comfort] Direction coverage: ${totalCoverage.toFixed(1)}% of wind hours`);
        
        // Собираем метаданные для каждого направления
        const directionMeta = {};
        for (const [angleStr, result] of validResults) {
            const angle = parseInt(angleStr);
            const sector = epwData.sectors.find(s => s.angle === angle);
            if (!sector) continue;
            
            const inputSpeed = result.data.wind_speed || result.speed || sector.meanSpeed;
            
            let climateSpeed;
            switch (speedSource) {
                case 'p95':
                    climateSpeed = sector.p95Speed || inputSpeed * 2.5;
                    break;
                case 'gem':
                    climateSpeed = inputSpeed * 2.0;
                    break;
                case 'max':
                    climateSpeed = sector.maxSpeed || inputSpeed * 3.5;
                    break;
                case 'cfd':
                default:
                    climateSpeed = inputSpeed;
            }
            
            directionMeta[angle] = {
                inputSpeed,
                climateSpeed,
                frequency: sector.frequency / totalCoverage,
                grid: result.data.grid.values
            };
            
            console.log(`[Comfort] ${angle}°: input=${inputSpeed.toFixed(2)}, climate=${climateSpeed.toFixed(2)}, freq=${(sector.frequency).toFixed(1)}%`);
        }
        
        // Для каждой точки сетки
        for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
                const realSpeedFreqPairs = [];
                let maxRealSpeed = 0;
                let weightedRealSpeed = 0;
                
                for (const [angleStr, meta] of Object.entries(directionMeta)) {
                    const vCfd = meta.grid[iy]?.[ix] ?? 0;
                    const K = meta.inputSpeed > 0 ? vCfd / meta.inputSpeed : 1.0;
                    const vReal = K * meta.climateSpeed;
                    
                    realSpeedFreqPairs.push({ 
                        speed: vReal, 
                        frequency: meta.frequency,
                        K: K
                    });
                    
                    maxRealSpeed = Math.max(maxRealSpeed, vReal);
                    weightedRealSpeed += vReal * meta.frequency;
                }
                
                comfortGrid[iy][ix] = weightedRealSpeed;
                
                if (this.settings.standard === 'lawson') {
                    let category = 'dangerous';
                    
                    for (const { key, threshold } of LAWSON_THRESHOLDS) {
                        if (threshold === Infinity) {
                            category = 'dangerous';
                            break;
                        }
                        
                        let pExceed = 0;
                        for (const { speed, frequency } of realSpeedFreqPairs) {
                            if (speed > threshold) {
                                pExceed += frequency;
                            }
                        }
                        
                        if (pExceed < 0.05) {
                            category = key;
                            break;
                        }
                    }
                    
                    categoryGrid[iy][ix] = category;
                    exceedGrid[iy][ix] = maxRealSpeed;
                    
                } else {
                    // NEN 8100
                    let pExceed5 = 0;
                    for (const { speed, frequency } of realSpeedFreqPairs) {
                        if (speed > 5.0) {
                            pExceed5 += frequency;
                        }
                    }
                    
                    exceedGrid[iy][ix] = pExceed5 * 100;
                    categoryGrid[iy][ix] = this.getNEN8100Category(pExceed5 * 100);
                }
            }
        }
        
        // Статистика категорий
        const categoryCount = {};
        for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
                const cat = categoryGrid[iy][ix];
                categoryCount[cat] = (categoryCount[cat] || 0) + 1;
            }
        }
        console.log('[Comfort] Category distribution:', categoryCount);
        
        // Сохраняем результаты
        this.comfortData = {
            grid: {
                nx, ny,
                spacing: grid.spacing,
                origin: grid.origin,
                values: comfortGrid,
                categories: categoryGrid,
                exceedance: exceedGrid
            },
            standard: this.settings.standard,
            speedSource: speedSource,
            directionsCoverage: totalCoverage,
            directionsUsed: validResults.length,
            categoryDistribution: categoryCount,
            timestamp: new Date().toISOString()
        };
        
        return this.comfortData;
    }
    
    /**
     * Определяет категорию NEN 8100 по вероятности превышения
     */
    getNEN8100Category(exceedPercent) {
        if (exceedPercent < 2.5) return 'A';
        if (exceedPercent < 5.0) return 'B';
        if (exceedPercent < 10.0) return 'C';
        if (exceedPercent < 20.0) return 'D';
        return 'E';
    }
    
    /**
     * Получает цвет для категории комфорта
     */
    getComfortColor(category) {
        if (this.settings.standard === 'lawson') {
            return LAWSON_CRITERIA[category]?.color || [128, 128, 128];
        } else {
            return NEN8100_CRITERIA[category]?.color || [128, 128, 128];
        }
    }
    
    /**
     * Рендеринг overlay комфорта
     */
    renderOverlay(sliceHeight) {
        this.hideOverlay();
        
        if (!this.comfortData?.grid) return;
        
        const grid = this.comfortData.grid;
        const nx = grid.nx;
        const ny = grid.ny;
        const spacing = grid.spacing;
        const origin = grid.origin;
        
        const scale = Math.min(4, Math.floor(512 / Math.max(nx, ny)));
        const texWidth = nx * scale;
        const texHeight = ny * scale;
        
        const canvas = document.createElement('canvas');
        canvas.width = texWidth;
        canvas.height = texHeight;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(texWidth, texHeight);
        
        for (let ty = 0; ty < texHeight; ty++) {
            for (let tx = 0; tx < texWidth; tx++) {
                const ix = Math.floor(tx / scale);
                const iy = Math.floor(ty / scale);
                
                const category = grid.categories[iy]?.[ix] || 'A';
                const color = this.getComfortColor(category);
                
                const idx = ((texHeight - 1 - ty) * texWidth + tx) * 4;
                imageData.data[idx] = color[0];
                imageData.data[idx + 1] = color[1];
                imageData.data[idx + 2] = color[2];
                imageData.data[idx + 3] = 200;
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
        
        const texture = new this.THREE.CanvasTexture(canvas);
        texture.magFilter = this.THREE.NearestFilter;
        texture.minFilter = this.THREE.NearestFilter;
        
        const width = nx * spacing;
        const height = ny * spacing;
        
        const geometry = new this.THREE.PlaneGeometry(width, height);
        const material = new this.THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.85,
            side: this.THREE.DoubleSide
        });
        
        this.comfortOverlay = new this.THREE.Mesh(geometry, material);
        this.comfortOverlay.position.set(
            origin[0] + width / 2,
            origin[1] + height / 2,
            sliceHeight + 0.1
        );
        
        this.sceneManager.scene.add(this.comfortOverlay);
        this.settings.showComfort = true;
        
        console.log(`[Comfort] Overlay rendered: ${nx}x${ny}`);
    }
    
    /**
     * Скрывает overlay комфорта
     */
    hideOverlay() {
        if (this.comfortOverlay) {
            this.sceneManager.scene.remove(this.comfortOverlay);
            if (this.comfortOverlay.material.map) {
                this.comfortOverlay.material.map.dispose();
            }
            this.comfortOverlay.material.dispose();
            this.comfortOverlay.geometry.dispose();
            this.comfortOverlay = null;
        }
        
        this.settings.showComfort = false;
    }
    
    /**
     * Генерация HTML легенды комфорта
     */
    renderLegend() {
        let html = '<div style="font-size: 12px; font-weight: 600; margin-bottom: 6px;">Категории комфорта:</div>';
        
        const criteria = this.settings.standard === 'lawson' ? LAWSON_CRITERIA : NEN8100_CRITERIA;
        
        html += '<div style="display: grid; gap: 4px;">';
        for (const [key, data] of Object.entries(criteria)) {
            const rgb = data.color;
            const threshold = data.threshold !== undefined 
                ? `(<${data.threshold === Infinity ? '∞' : data.threshold} м/с)`
                : `(P<${data.maxExceed}%)`;
            
            html += `
                <div style="display: flex; align-items: center; gap: 6px;">
                    <div style="width: 20px; height: 14px; background: rgb(${rgb[0]},${rgb[1]},${rgb[2]}); border-radius: 2px; border: 1px solid #ccc;"></div>
                    <span style="font-size: 11px;"><strong>${data.label}</strong> - ${data.desc} ${threshold}</span>
                </div>
            `;
        }
        html += '</div>';
        
        return html;
    }
    
    /**
     * Экспорт данных комфорта в JSON
     */
    exportData(epwData) {
        if (!this.comfortData) {
            throw new Error('Сначала рассчитайте комфорт');
        }
        
        return {
            ...this.comfortData,
            epw: {
                location: epwData?.location || 'Unknown',
                filename: epwData?.filename || 'Unknown'
            },
            settings: this.settings
        };
    }
    
    /**
     * Очистка
     */
    destroy() {
        this.hideOverlay();
        this.comfortData = null;
    }
}

/**
 * Генерация HTML секции комфорта для UI
 */
export function renderComfortSection(count, settings) {
    const canAnalyze = count >= 4;
    
    if (!canAnalyze) {
        return `
            <div style="margin-top: 12px; padding: 10px; background: #fff3cd; border-radius: 6px; font-size: 12px;">
                ⚠️ Для анализа комфорта нужно минимум 4 направления (сейчас: ${count})
            </div>
        `;
    }
    
    return `
        <div class="wcfd-comfort-section" style="margin-top: 12px; padding-top: 12px; border-top: 2px solid #4a90e2;">
            <div class="wcfd-label" style="color: #4a90e2;">🌬️ Анализ ветрового комфорта</div>
            
            <div style="margin-bottom: 10px;">
                <label style="font-size: 12px; display: block; margin-bottom: 4px;">Стандарт:</label>
                <select id="wcfd-comfort-standard" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #ddd;">
                    <option value="lawson" ${settings.standard === 'lawson' ? 'selected' : ''}>Lawson LDDC (UK)</option>
                    <option value="nen8100" ${settings.standard === 'nen8100' ? 'selected' : ''}>NEN 8100 (NL)</option>
                </select>
            </div>
            
            <div style="margin-bottom: 10px;">
                <label style="font-size: 12px; display: block; margin-bottom: 4px;">Скорость ветра для анализа:</label>
                <select id="wcfd-comfort-speed-source" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #ddd;">
                    <option value="gem" ${settings.speedSource === 'gem' ? 'selected' : ''}>GEM (Mean×2.0) — рекомендуется</option>
                    <option value="p95" ${settings.speedSource === 'p95' ? 'selected' : ''}>P95 из EPW (более строгий)</option>
                    <option value="max" ${settings.speedSource === 'max' ? 'selected' : ''}>Максимум из EPW (очень строгий)</option>
                    <option value="cfd" ${settings.speedSource === 'cfd' ? 'selected' : ''}>Прямо из CFD (debug)</option>
                </select>
            </div>
            
            <div style="background: #f0f7ff; padding: 8px; border-radius: 6px; margin-bottom: 10px; font-size: 11px;">
                <div id="wcfd-comfort-info">
                    <strong>Метод:</strong> K × V<sub>climate</sub><br>
                    K = коэффициент усиления (из CFD)<br>
                    V<sub>climate</sub> = P95 скорость (из EPW)<br>
                    <strong>Используется:</strong> ${count} из 8 направлений
                </div>
            </div>
            
            <button class="wcfd-btn wcfd-btn-primary" id="wcfd-calc-comfort" style="background: #2196F3;">
                📊 Рассчитать комфорт
            </button>
            
            <div id="wcfd-comfort-legend" class="wcfd-hidden" style="margin-top: 10px;"></div>
            
            <button class="wcfd-btn wcfd-hidden" id="wcfd-hide-comfort" style="margin-top: 6px;">
                Скрыть комфорт
            </button>
            <button class="wcfd-btn wcfd-hidden" id="wcfd-export-comfort" style="margin-top: 6px;">
                📥 Экспорт комфорта
            </button>
        </div>
    `;
}