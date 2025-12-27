/**
 * ============================================
 * WindCFD.js
 * CFD ветровой анализ с интеграцией EPW
 * Поддержка множественных направлений
 * Пакетный расчёт всех направлений
 * v2.1 - Стрелка направления + векторный режим
 * v3.0 - Wind Comfort Analysis (Lawson / NEN 8100)
 * ============================================
 */

class WindCFD {
    constructor(sceneManager, coords) {
        this.sceneManager = sceneManager;
        this.coords = coords;
        
        // Session ID для multi-user
        this.sessionId = this._getOrCreateSessionId();
        
        // Состояние
        this.selectedBuildings = [];
        this.epwData = null;
        this.selectedDirection = null;
        this.selectedSpeed = null;
        this.speedType = 'mean'; // 'mean' | 'p95' | 'p99' | 'max' | 'custom'
        this.domainMesh = null;
        this.domainVisible = true;
        this.windOverlay = null;
        this.isCalculating = false;
        this.pollingStopped = false;
        this.currentConfig = null;
        
        // v2.1: Стрелка направления ветра
        this.windArrow = null;
        this.windArrowLabel = null;
        this.windArrowLoopId = 0; // ID для отмены старых requestAnimationFrame loops
        this.windArrowLabelId = 0; // Уникальный ID для requestAnimationFrame loop
        
        // v2.1: Векторное поле
        this.vectorField = null;
        this.vectorArrows = [];
        this.displayMode = 'gradient'; // 'gradient' | 'vectors' | 'both'
        this.vectorDensity = 60;
        this.vectorScale = 3;
        
        // Пакетный расчёт
        this.batchMode = false;
        this.batchQueue = [];
        this.batchTotal = 0;
        this.batchCompleted = 0;
        
        // Хранилище результатов по направлениям
        // { angle: { data, speed, case_dir, case_name, cached? } }
        this.results = {};
        this.activeDirection = null; // Текущее отображаемое направление
        
        // Настройки CFD (COST 732 / AIJ Guidelines)
        // Эти значения отправляются на сервер и перезаписывают серверные дефолты
        this.domainSettings = {
            // Домен (множители от H - высоты самого высокого здания)
            // COST 732: inlet 5H, outlet 10-15H, lateral 5H, height 5-6H
            // Меньшие значения (inlet 3, outlet 6) = быстрее, но менее точный wake
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
        
        // Модель турбулентности
        this.turbulenceModel = 'k-epsilon'; // k-ε (RANS)
        
        // Настройки визуализации векторов
        
        // Аниматор потоков (инициализируется позже)
        this.flowAnimator = null;
        
        // Цветовая шкала для абсолютных скоростей (м/с) - как в Paraview
        this.colorScale = [
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
        
        // Диапазон скоростей (будет обновляться из данных)
        this.speedRange = { min: 0, max: 6 };
        
        // Высота сечения
        this.sliceHeight = 1.75; // метров (уровень пешехода)
        
        // ==================== Wind Comfort Analysis ====================
        // Настройки анализа комфорта
        this.comfortSettings = {
            standard: 'lawson',  // 'lawson' | 'nen8100'
            speedSource: 'gem',  // 'cfd' | 'gem' | 'p95' | 'max' - какую скорость использовать
            showComfort: false   // Показывать ли overlay комфорта
        };
        
        // Комфортный overlay
        this.comfortOverlay = null;
        this.comfortData = null;
        
        // Lawson LDDC Criteria (2001) - пороги для 5% превышения
        this.lawsonCriteria = {
            sitting_long:  { threshold: 2.5, color: [34, 139, 34],   label: 'A - Длит. сидение', desc: 'Парки, кафе' },
            sitting_short: { threshold: 4.0, color: [144, 238, 144], label: 'B - Корот. сидение', desc: 'Скамейки' },
            standing:      { threshold: 6.0, color: [255, 255, 0],   label: 'C - Стояние', desc: 'Остановки' },
            walking:       { threshold: 8.0, color: [255, 165, 0],   label: 'D - Прогулка', desc: 'Тротуары' },
            uncomfortable: { threshold: 10.0, color: [255, 0, 0],    label: 'E - Некомфортно', desc: 'Проходы' },
            dangerous:     { threshold: Infinity, color: [139, 0, 0], label: 'S - Опасно', desc: 'Недопустимо' }
        };
        
        // NEN 8100 (Dutch standard) - вероятность P(U > 5 м/с)
        this.nen8100Criteria = {
            A: { maxExceed: 2.5,  color: [34, 139, 34],   label: 'A - Отлично', desc: 'Длит. сидение' },
            B: { maxExceed: 5.0,  color: [144, 238, 144], label: 'B - Хорошо', desc: 'Корот. сидение' },
            C: { maxExceed: 10.0, color: [255, 255, 0],   label: 'C - Умеренно', desc: 'Прогулки' },
            D: { maxExceed: 20.0, color: [255, 165, 0],   label: 'D - Плохо', desc: 'Только проходы' },
            E: { maxExceed: Infinity, color: [255, 0, 0], label: 'E - Некомфортно', desc: 'Недопустимо' }
        };
        
        // CFD Server URL
        this.serverUrl = 'http://localhost:8765';
        
        this.panel = null;
        this.createPanel();
        
        // Загружаем существующие результаты с сервера
        this.loadCachedDirections();
        
        console.log('[WindCFD] Инициализирован v2.3 (multi-user), session:', this.sessionId.substring(0, 8));
    }
    
    // ==================== Session Management ====================
    
    _getOrCreateSessionId() {
        let sessionId = localStorage.getItem('cfd_session_id');
        if (!sessionId) {
            sessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
            localStorage.setItem('cfd_session_id', sessionId);
        }
        return sessionId;
    }
    
    async _fetch(url, options = {}) {
        const headers = {
            'X-Session-ID': this.sessionId,
            ...(options.headers || {})
        };
        return fetch(url, { ...options, headers });
    }
    
    // ==================== Загрузка кеша с сервера ====================
    
    async loadCachedDirections() {
        try {
            const resp = await this._fetch(`${this.serverUrl}/directions`);
            if (!resp.ok) return;
            
            const data = await resp.json();
            const directions = data.directions || {};
            
            console.log('[WindCFD] Найдено кешированных направлений:', Object.keys(directions));
            
            // Помечаем направления как доступные (без загрузки полных данных)
            for (const [angle, info] of Object.entries(directions)) {
                const angleNum = parseInt(angle);
                if (!this.results[angleNum]) {
                    this.results[angleNum] = {
                        data: null,  // Загрузим по требованию
                        case_dir: info.case_dir,
                        case_name: info.case_name,
                        cached: true  // Флаг что нужно загрузить данные
                    };
                }
            }
            
            this.renderWindRose();
        } catch (e) {
            console.log('[WindCFD] Сервер недоступен для загрузки кеша');
        }
    }
    
    async loadDirectionData(angle) {
        try {
            const resp = await this._fetch(`${this.serverUrl}/result/${angle}`);
            if (!resp.ok) return null;
            
            const data = await resp.json();
            return data;
        } catch (e) {
            console.error(`[WindCFD] Ошибка загрузки данных для ${angle}°:`, e);
            return null;
        }
    }
    
    // ==================== UI ====================
    
    createPanel() {
        const existing = document.getElementById('wind-cfd-panel');
        if (existing) existing.remove();
        
        this.panel = document.createElement('div');
        this.panel.id = 'wind-cfd-panel';
        this.panel.className = 'wind-cfd-panel hidden';
        this.panel.innerHTML = `
            <div class="wcfd-header">
                <h3>🌀 CFD Ветровой анализ</h3>
                <button class="wcfd-close" id="wcfd-close">×</button>
            </div>
            
            <div class="wcfd-section">
                <div class="wcfd-label">1. Выбранные здания</div>
                <div class="wcfd-buildings-info" id="wcfd-buildings-info">Не выбрано</div>
                <button class="wcfd-btn" id="wcfd-select-buildings">Выбрать здания</button>
            </div>
            
            <div class="wcfd-section">
                <div class="wcfd-label">2. Расчётный домен</div>
                <div class="wcfd-domain-info" id="wcfd-domain-info">—</div>
                <label class="wcfd-checkbox">
                    <input type="checkbox" id="wcfd-show-domain" checked>
                    Показать домен
                </label>
            </div>
            
            <div class="wcfd-section">
                <div class="wcfd-label">3. Погодные данные (EPW)</div>
                <div class="wcfd-epw-info" id="wcfd-epw-info">Файл не загружен</div>
                <button class="wcfd-btn" id="wcfd-load-epw">Загрузить EPW</button>
            </div>
            
            <div class="wcfd-section wcfd-hidden" id="wcfd-direction-section">
                <div class="wcfd-label">4. Направление ветра</div>
                <div class="wcfd-wind-rose" id="wcfd-wind-rose"></div>
                <div class="wcfd-selected-wind" id="wcfd-selected-wind">—</div>
            </div>
            
            <!-- Настройки CFD (сворачиваемые) -->
            <div class="wcfd-section" id="wcfd-cfd-settings-section">
                <div class="wcfd-label wcfd-collapsible" id="wcfd-settings-toggle" style="cursor: pointer;">
                    ⚙️ Настройки CFD <span style="float: right; font-size: 10px;">▼</span>
                </div>
                <div id="wcfd-settings-content" style="display: none; margin-top: 10px;">
                    <div style="background: #e8f4e8; padding: 8px; border-radius: 4px; margin-bottom: 10px; font-size: 12px;">
                        <strong>Модель:</strong> k-ε (RANS)<br>
                        <strong>Стандарт:</strong> COST 732 / AIJ
                    </div>
                    
                    <div class="wcfd-setting-group">
                        <label>Домен (×H) <span class="wcfd-help" title="H = высота самого высокого здания. Размеры домена влияют на точность и время расчёта.">?</span></label>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 5px;">
                            <div>
                                <span style="font-size: 11px;" title="Расстояние от зданий до входной границы (откуда дует ветер). Рекомендуется 3-5H.">Inlet:</span>
                                <input type="number" id="wcfd-inlet-factor" value="5" min="2" max="10" step="0.5" style="width: 100%;">
                            </div>
                            <div>
                                <span style="font-size: 11px;" title="Расстояние до выходной границы (за зданиями). Важно для wake-зоны. Рекомендуется 6-15H.">Outlet:</span>
                                <input type="number" id="wcfd-outlet-factor" value="8" min="5" max="20" step="1" style="width: 100%;">
                            </div>
                            <div>
                                <span style="font-size: 11px;" title="Расстояние по бокам от зданий. Рекомендуется 2-5H.">Lateral:</span>
                                <input type="number" id="wcfd-lateral-factor" value="2.5" min="2" max="5" step="0.5" style="width: 100%;">
                            </div>
                            <div>
                                <span style="font-size: 11px;" title="Высота расчётного домена. Рекомендуется 5-6H для корректного ABL профиля.">Height:</span>
                                <input type="number" id="wcfd-height-factor" value="5" min="4" max="8" step="1" style="width: 100%;">
                            </div>
                        </div>
                    </div>
                    
                    <div class="wcfd-setting-group" style="margin-top: 10px;">
                        <label>Сетка <span class="wcfd-help" title="Параметры расчётной сетки. Мельче сетка = точнее, но дольше.">?</span></label>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 5px;">
                            <div>
                                <span style="font-size: 11px;" title="Размер базовой ячейки blockMesh. Меньше = больше ячеек, точнее результат.">Ячейка (м):</span>
                                <input type="number" id="wcfd-cell-size" value="5" min="2" max="10" step="1" style="width: 100%;">
                            </div>
                            <div>
                                <span style="font-size: 11px;" title="Максимальное количество ячеек (миллионы). Ограничивает память и время.">Макс. ячеек (M):</span>
                                <input type="number" id="wcfd-max-cells" value="3" min="1" max="10" step="1" style="width: 100%;">
                            </div>
                            <div>
                                <span style="font-size: 11px;" title="Минимальный уровень измельчения сетки у зданий. 0=без измельчения.">Refine min:</span>
                                <input type="number" id="wcfd-refine-min" value="1" min="0" max="3" step="1" style="width: 100%;">
                            </div>
                            <div>
                                <span style="font-size: 11px;" title="Максимальный уровень измельчения. Каждый уровень делит ячейку на 8.">Refine max:</span>
                                <input type="number" id="wcfd-refine-max" value="2" min="1" max="4" step="1" style="width: 100%;">
                            </div>
                        </div>
                    </div>
                    
                    <div class="wcfd-setting-group" style="margin-top: 10px;">
                        <label>Расчёт <span class="wcfd-help" title="Параметры солвера simpleFoam.">?</span></label>
                        <div style="margin-top: 5px;">
                            <span style="font-size: 11px;" title="Количество итераций SIMPLE. Обычно сходится за 200-500. Больше = стабильнее.">Итерации:</span>
                            <input type="number" id="wcfd-iterations" value="400" min="100" max="1000" step="50" style="width: 100%;">
                        </div>
                    </div>
                    
                    <button class="wcfd-btn" id="wcfd-apply-settings" style="margin-top: 10px; width: 100%;">
                        ✓ Применить настройки
                    </button>
                </div>
            </div>
            
            <!-- Настройки визуализации векторов -->
            <div class="wcfd-section wcfd-hidden" id="wcfd-vector-settings-section">
                <div class="wcfd-label wcfd-collapsible" id="wcfd-vector-toggle" style="cursor: pointer;">
                    🌊 Анимация потоков <span style="float: right; font-size: 10px;">▼</span>
                </div>
                <div id="wcfd-vector-content" style="display: none; margin-top: 10px;">
                    <div class="wcfd-setting-group">
                        <label>Настройки анимации <span class="wcfd-help" title="Анимированные частицы, движущиеся по векторному полю скоростей.">?</span></label>
                        <div style="margin-top: 8px;">
                            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                <span style="font-size: 11px; width: 80px;" title="Количество частиц. Больше = плотнее поток, но тяжелее для GPU.">Частицы:</span>
                                <input type="range" id="wcfd-flow-particles" min="100" max="10000" step="100" value="800" style="flex: 1;">
                                <span id="wcfd-flow-particles-val" style="width: 50px; text-align: right; font-size: 11px;">800</span>
                            </div>
                            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                <span style="font-size: 11px; width: 80px;" title="Множитель скорости. 1x = реальная скорость ветра.">Скорость:</span>
                                <input type="range" id="wcfd-flow-speed" min="1" max="20" step="1" value="5" style="flex: 1;">
                                <span id="wcfd-flow-speed-val" style="width: 50px; text-align: right; font-size: 11px;">5x</span>
                            </div>
                            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                <span style="font-size: 11px; width: 80px;" title="Длина следа (хвоста) за каждой частицей.">Длина следа:</span>
                                <input type="range" id="wcfd-flow-trail" min="10" max="500" step="10" value="50" style="flex: 1;">
                                <span id="wcfd-flow-trail-val" style="width: 50px; text-align: right; font-size: 11px;">50</span>
                            </div>
                            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                <span style="font-size: 11px; width: 80px;" title="Время жизни частицы в секундах. Дольше = длиннее траектории.">Время жизни:</span>
                                <input type="range" id="wcfd-flow-lifetime" min="2" max="60" step="1" value="10" style="flex: 1;">
                                <span id="wcfd-flow-lifetime-val" style="width: 50px; text-align: right; font-size: 11px;">10 сек</span>
                            </div>
                            <div style="display: flex; align-items: center;">
                                <input type="checkbox" id="wcfd-flow-color-speed" checked style="margin-right: 8px;">
                                <span style="font-size: 11px;">Цвет по скорости</span>
                            </div>
                        </div>
                        <button class="wcfd-btn wcfd-btn-primary" id="wcfd-toggle-flow" style="margin-top: 10px; width: 100%;">
                            ▶️ Запустить анимацию
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="wcfd-section" id="wcfd-calc-section">
                <button class="wcfd-btn wcfd-btn-primary" id="wcfd-calculate" disabled>Запустить расчёт</button>
                <button class="wcfd-btn wcfd-btn-success" id="wcfd-calculate-all" disabled>🔄 Рассчитать все направления</button>
                <button class="wcfd-btn" id="wcfd-clear-server" style="margin-top: 10px; font-size: 12px;">🗑️ Очистить кеш сервера</button>
                <div class="wcfd-progress hidden" id="wcfd-progress">
                    <div class="wcfd-spinner"></div>
                    <span id="wcfd-progress-text">Расчёт...</span>
                </div>
            </div>
            
            <!-- Фиксированная секция прогресса расчёта -->
            <div class="wcfd-section wcfd-hidden" id="wcfd-calc-progress-section">
                <div class="wcfd-label">⏳ Расчёт в процессе</div>
                <div id="wcfd-calc-progress-info" style="font-size: 13px; margin-bottom: 8px;">—</div>
                <div style="background: #e0e0e0; border-radius: 10px; height: 16px; overflow: hidden;">
                    <div id="wcfd-calc-progress-bar" style="background: linear-gradient(90deg, #4CAF50, #8BC34A); height: 100%; width: 0%; transition: width 0.5s;"></div>
                </div>
                <div id="wcfd-calc-progress-iter" style="margin-top: 6px; color: #666; font-size: 12px;">—</div>
                <button class="wcfd-btn wcfd-btn-danger" id="wcfd-calc-stop" style="margin-top: 8px;">⏹ Остановить</button>
            </div>
            
            <div class="wcfd-section wcfd-hidden" id="wcfd-results-section">
                <div class="wcfd-label">Результаты</div>
                <div class="wcfd-results-count" id="wcfd-results-count"></div>
                <div class="wcfd-slice-control" id="wcfd-slice-control">
                    <div class="wcfd-slice-header">
                        <span>Высота сечения:</span>
                        <span class="wcfd-slice-value" id="wcfd-slice-value">1.75 м</span>
                    </div>
                    <input type="range" id="wcfd-slice-slider" min="0.5" max="50" step="0.25" value="1.75">
                    <button class="wcfd-btn" id="wcfd-resample">🔄 Пересчитать срез</button>
                </div>
                <div class="wcfd-legend" id="wcfd-legend"></div>
                <button class="wcfd-btn" id="wcfd-hide-results">Скрыть результаты</button>
                <button class="wcfd-btn" id="wcfd-export-results">Экспорт JSON</button>
                <button class="wcfd-btn" id="wcfd-download-paraview">📦 Скачать для Paraview</button>
                <button class="wcfd-btn wcfd-btn-danger" id="wcfd-clear-all">Очистить все расчёты</button>
            </div>
        `;
        
        document.body.appendChild(this.panel);
        this.addStyles();
        this.bindEvents();
    }
    
    addStyles() {
        if (document.getElementById('wind-cfd-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'wind-cfd-styles';
        style.textContent = `
            .wind-cfd-panel {
                position: fixed;
                top: 80px;
                right: 20px;
                width: 320px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                z-index: 1000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
                max-height: calc(100vh - 100px);
                overflow-y: auto;
            }
            .wind-cfd-panel.hidden { display: none; }
            
            .wcfd-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px;
                border-bottom: 1px solid #eee;
            }
            .wcfd-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
            .wcfd-close {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #999;
                padding: 0;
                line-height: 1;
            }
            .wcfd-close:hover { color: #333; }
            
            .wcfd-section {
                padding: 12px 16px;
                border-bottom: 1px solid #f0f0f0;
            }
            .wcfd-section:last-child { border-bottom: none; }
            .wcfd-section.wcfd-hidden { display: none; }
            
            .wcfd-label {
                font-size: 12px;
                font-weight: 600;
                color: #666;
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .wcfd-buildings-info, .wcfd-domain-info, .wcfd-epw-info, .wcfd-selected-wind {
                background: #f8f9fa;
                padding: 10px;
                border-radius: 6px;
                margin-bottom: 10px;
                font-size: 13px;
            }
            
            .wcfd-btn {
                width: 100%;
                padding: 10px;
                border: 1px solid #ddd;
                background: white;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                transition: all 0.2s;
                margin-bottom: 6px;
            }
            .wcfd-btn:hover { border-color: #4a90e2; color: #4a90e2; }
            .wcfd-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .wcfd-btn:last-child { margin-bottom: 0; }
            
            .wcfd-btn-primary {
                background: #4a90e2;
                border-color: #4a90e2;
                color: white;
            }
            .wcfd-btn-primary:hover { background: #3a7bc8; color: white; }
            .wcfd-btn-primary:disabled { background: #ccc; border-color: #ccc; }
            
            .wcfd-btn-success {
                background: #28a745;
                border-color: #28a745;
                color: white;
            }
            .wcfd-btn-success:hover { background: #218838; color: white; }
            .wcfd-btn-success:disabled { background: #ccc; border-color: #ccc; }
            
            .wcfd-btn-danger {
                background: #dc3545;
                border-color: #dc3545;
                color: white;
            }
            .wcfd-btn-danger:hover { background: #c82333; color: white; }
            
            .wcfd-help {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 14px;
                height: 14px;
                background: #6c757d;
                color: white;
                border-radius: 50%;
                font-size: 10px;
                cursor: help;
                margin-left: 4px;
                position: relative;
            }
            .wcfd-help:hover {
                background: #4a90e2;
            }
            
            /* Кастомные tooltips */
            .wcfd-help::after,
            [data-tooltip]::after {
                content: attr(title);
                position: absolute;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                background: #333;
                color: white;
                padding: 6px 10px;
                border-radius: 4px;
                font-size: 11px;
                white-space: normal;
                width: max-content;
                max-width: 250px;
                text-align: left;
                z-index: 10000;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.2s, visibility 0.2s;
                pointer-events: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                line-height: 1.4;
                margin-bottom: 5px;
            }
            .wcfd-help:hover::after,
            [data-tooltip]:hover::after {
                opacity: 1;
                visibility: visible;
            }
            /* Стрелочка */
            .wcfd-help::before {
                content: '';
                position: absolute;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                border: 5px solid transparent;
                border-top-color: #333;
                margin-bottom: -5px;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.2s, visibility 0.2s;
                z-index: 10001;
            }
            .wcfd-help:hover::before {
                opacity: 1;
                visibility: visible;
            }
            
            /* Tooltips для span с title */
            span[title] {
                position: relative;
            }
            span[title]::after {
                content: attr(title);
                position: absolute;
                bottom: 100%;
                left: 0;
                background: #333;
                color: white;
                padding: 6px 10px;
                border-radius: 4px;
                font-size: 11px;
                white-space: normal;
                width: max-content;
                max-width: 220px;
                text-align: left;
                z-index: 10000;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.2s, visibility 0.2s;
                pointer-events: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                line-height: 1.4;
                margin-bottom: 5px;
            }
            span[title]:hover::after {
                opacity: 1;
                visibility: visible;
            }
            
            [title] {
                position: relative;
            }
            
            .wcfd-checkbox {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                cursor: pointer;
            }
            .wcfd-checkbox input { margin: 0; }
            
            .wcfd-wind-rose {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 6px;
                margin-bottom: 10px;
            }
            
            .wcfd-wind-btn {
                padding: 8px 4px;
                border: 2px solid #ddd;
                background: white;
                border-radius: 6px;
                cursor: pointer;
                font-size: 11px;
                text-align: center;
                transition: all 0.2s;
                position: relative;
            }
            .wcfd-wind-btn:hover { border-color: #4a90e2; }
            .wcfd-wind-btn.active {
                background: #4a90e2;
                border-color: #4a90e2;
                color: white;
            }
            .wcfd-wind-btn.calculated {
                border-color: #28a745;
                background: #d4edda;
            }
            .wcfd-wind-btn.calculated::after {
                content: '✓';
                position: absolute;
                top: 2px;
                right: 4px;
                color: #28a745;
                font-size: 10px;
                font-weight: bold;
            }
            .wcfd-wind-btn.calculated.active {
                background: #28a745;
                border-color: #28a745;
                color: white;
            }
            .wcfd-wind-btn.calculated.active::after {
                color: white;
            }
            .wcfd-wind-btn .dir { font-weight: 600; }
            .wcfd-wind-btn .speed { font-size: 10px; color: #666; }
            .wcfd-wind-btn.active .speed { color: rgba(255,255,255,0.8); }
            .wcfd-wind-btn.calculated .speed { color: #155724; }
            .wcfd-wind-btn.calculated.active .speed { color: rgba(255,255,255,0.8); }
            
            .wcfd-progress {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px;
                background: #f0f7ff;
                border-radius: 6px;
                margin-top: 10px;
            }
            .wcfd-progress.hidden { display: none; }
            
            .wcfd-spinner {
                width: 20px;
                height: 20px;
                border: 2px solid #ddd;
                border-top-color: #4a90e2;
                border-radius: 50%;
                animation: wcfd-spin 1s linear infinite;
            }
            @keyframes wcfd-spin { to { transform: rotate(360deg); } }
            
            .wcfd-legend {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-bottom: 10px;
            }
            .wcfd-legend-item {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 10px;
            }
            .wcfd-legend-color {
                width: 16px;
                height: 12px;
                border-radius: 2px;
                border: 1px solid rgba(0,0,0,0.1);
            }
            
            .wcfd-results-count {
                font-size: 12px;
                color: #666;
                margin-bottom: 8px;
            }
            
            .wcfd-slice-control {
                background: #f0f7ff;
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 12px;
            }
            .wcfd-slice-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
                font-size: 13px;
            }
            .wcfd-slice-value {
                font-weight: 600;
                color: #4a90e2;
                font-size: 14px;
            }
            #wcfd-slice-slider {
                width: 100%;
                margin-bottom: 10px;
                accent-color: #4a90e2;
            }
            
            .wcfd-height-label {
                position: absolute;
                background: rgba(74, 144, 226, 0.9);
                color: white;
                padding: 4px 10px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 600;
                pointer-events: none;
                white-space: nowrap;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            }
            
            .wcfd-batch-progress {
                padding: 5px 0;
            }
            .wcfd-batch-status {
                font-weight: 600;
                margin-bottom: 10px;
                font-size: 14px;
            }
            .wcfd-batch-bar-container {
                background: #e0e0e0;
                border-radius: 10px;
                height: 20px;
                overflow: hidden;
                margin-bottom: 10px;
            }
            .wcfd-batch-bar {
                background: linear-gradient(90deg, #4CAF50, #8BC34A);
                height: 100%;
                transition: width 0.5s;
                border-radius: 10px;
            }
            .wcfd-batch-details {
                font-size: 12px;
                color: #666;
                margin-bottom: 10px;
                max-height: 150px;
                overflow-y: auto;
            }
            .wcfd-batch-item {
                padding: 4px 0;
                border-bottom: 1px solid #eee;
                display: flex;
                justify-content: space-between;
            }
            .wcfd-batch-item.done { color: #28a745; }
            .wcfd-batch-item.active { color: #4a90e2; font-weight: 600; }
            .wcfd-batch-item.pending { color: #999; }
            
            .wcfd-gradient-legend {
                margin-bottom: 10px;
            }
            .wcfd-gradient-bar {
                height: 16px;
                border-radius: 4px;
                background: linear-gradient(to right, 
                    rgb(59, 76, 192),
                    rgb(98, 130, 234),
                    rgb(141, 176, 254),
                    rgb(184, 208, 249),
                    rgb(221, 221, 221),
                    rgb(245, 196, 173),
                    rgb(244, 154, 123),
                    rgb(222, 96, 77),
                    rgb(180, 4, 38)
                );
                border: 1px solid rgba(0,0,0,0.1);
            }
            .wcfd-gradient-labels {
                display: flex;
                justify-content: space-between;
                font-size: 11px;
                color: #666;
                margin-top: 4px;
            }
            
            /* v2.1: Стили для режимов отображения */
            .wcfd-mode-buttons {
                display: flex;
                gap: 4px;
                margin-bottom: 10px;
            }
            .wcfd-mode-btn {
                flex: 1;
                padding: 8px 4px;
                border: 2px solid #ddd;
                background: white;
                border-radius: 6px;
                cursor: pointer;
                font-size: 11px;
                transition: all 0.2s;
            }
            .wcfd-mode-btn:hover { border-color: #4a90e2; }
            .wcfd-mode-btn.active {
                background: #4a90e2;
                border-color: #4a90e2;
                color: white;
            }
            .wcfd-vector-settings {
                background: #f8f9fa;
                border-radius: 6px;
                padding: 10px;
                margin-bottom: 10px;
            }
            .wcfd-vector-settings.wcfd-hidden { display: none; }
            #wcfd-density-slider, #wcfd-scale-slider {
                width: 100%;
                margin-bottom: 8px;
                accent-color: #4a90e2;
            }
        `;
        document.head.appendChild(style);
    }
    
    bindEvents() {
        document.getElementById('wcfd-close').onclick = () => this.hide();
        document.getElementById('wcfd-select-buildings').onclick = () => this.startBuildingSelection();
        document.getElementById('wcfd-load-epw').onclick = () => this.loadEPW();
        document.getElementById('wcfd-show-domain').onchange = (e) => this.toggleDomain(e.target.checked);
        document.getElementById('wcfd-calculate').onclick = () => this.startCalculation();
        document.getElementById('wcfd-calculate-all').onclick = () => this.calculateAllDirections();
        document.getElementById('wcfd-clear-server').onclick = () => this.clearServerCache();
        document.getElementById('wcfd-calc-stop').onclick = () => this.stopCalculation();
        
        // Настройки CFD
        document.getElementById('wcfd-settings-toggle').onclick = () => this.toggleCFDSettings();
        document.getElementById('wcfd-apply-settings').onclick = () => this.applyCFDSettings();
        
        // Настройки анимации потоков
        document.getElementById('wcfd-vector-toggle').onclick = () => this.toggleVectorSettings();
        
        // Слайдеры анимации потоков
        document.getElementById('wcfd-flow-particles').oninput = (e) => {
            document.getElementById('wcfd-flow-particles-val').textContent = e.target.value;
        };
        document.getElementById('wcfd-flow-speed').oninput = (e) => {
            document.getElementById('wcfd-flow-speed-val').textContent = e.target.value + 'x';
        };
        document.getElementById('wcfd-flow-trail').oninput = (e) => {
            document.getElementById('wcfd-flow-trail-val').textContent = e.target.value;
        };
        document.getElementById('wcfd-flow-lifetime').oninput = (e) => {
            document.getElementById('wcfd-flow-lifetime-val').textContent = e.target.value + ' сек';
        };
        document.getElementById('wcfd-toggle-flow').onclick = () => this.toggleFlowAnimation();
        // Остальные элементы (slice-slider, resample, etc.) привязываются в updateResultsSection
    }
    
    toggleCFDSettings() {
        const content = document.getElementById('wcfd-settings-content');
        const toggle = document.getElementById('wcfd-settings-toggle');
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        toggle.innerHTML = `⚙️ Настройки CFD <span style="float: right; font-size: 10px;">${isHidden ? '▲' : '▼'}</span>`;
    }
    
    toggleVectorSettings() {
        const content = document.getElementById('wcfd-vector-content');
        const toggle = document.getElementById('wcfd-vector-toggle');
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        toggle.innerHTML = `🌊 Анимация потоков <span style="float: right; font-size: 10px;">${isHidden ? '▲' : '▼'}</span>`;
    }
    
    toggleFlowAnimation() {
        const btn = document.getElementById('wcfd-toggle-flow');
        
        // Проверяем наличие результата
        if (this.activeDirection === null || !this.results[this.activeDirection]) {
            alert('Сначала выполните расчёт и выберите направление для просмотра');
            return;
        }
        
        const data = this.results[this.activeDirection].data;
        
        // Инициализируем аниматор если ещё нет
        if (!this.flowAnimator) {
            if (typeof WindFlowAnimation === 'undefined') {
                alert('Модуль WindFlowAnimation.js не загружен. Добавьте <script src="WindFlowAnimation.js"> в HTML.');
                return;
            }
            this.flowAnimator = new WindFlowAnimation(this.sceneManager, this);
        }
        
        // Toggle
        if (this.flowAnimator.running) {
            // Остановить
            this.flowAnimator.stop();
            btn.textContent = '▶️ Запустить анимацию';
            btn.classList.remove('wcfd-btn-danger');
            btn.classList.add('wcfd-btn-primary');
        } else {
            // Читаем настройки из UI
            const settings = {
                particleCount: parseInt(document.getElementById('wcfd-flow-particles').value) || 800,
                speedMultiplier: parseFloat(document.getElementById('wcfd-flow-speed').value) || 5.0,
                fadeLength: parseInt(document.getElementById('wcfd-flow-trail').value) || 50,
                particleLifetime: parseFloat(document.getElementById('wcfd-flow-lifetime').value) || 10.0,
                colorBySpeed: document.getElementById('wcfd-flow-color-speed').checked
            };
            
            this.flowAnimator.updateSettings(settings);
            this.flowAnimator.start(data);
            
            btn.textContent = '⏹️ Остановить анимацию';
            btn.classList.remove('wcfd-btn-primary');
            btn.classList.add('wcfd-btn-danger');
        }
    }
    
    // Остановка анимации при смене результата
    stopFlowAnimationIfRunning() {
        if (this.flowAnimator && this.flowAnimator.running) {
            this.flowAnimator.stop();
            const btn = document.getElementById('wcfd-toggle-flow');
            if (btn) {
                btn.textContent = '▶️ Запустить анимацию';
                btn.classList.remove('wcfd-btn-danger');
                btn.classList.add('wcfd-btn-primary');
            }
        }
    }
    
    applyCFDSettings() {
        // Читаем значения из UI
        this.domainSettings.inletFactor = parseFloat(document.getElementById('wcfd-inlet-factor').value) || 5;
        this.domainSettings.outletFactor = parseFloat(document.getElementById('wcfd-outlet-factor').value) || 8;
        this.domainSettings.lateralFactor = parseFloat(document.getElementById('wcfd-lateral-factor').value) || 2.5;
        this.domainSettings.heightFactor = parseFloat(document.getElementById('wcfd-height-factor').value) || 5;
        this.domainSettings.cellSize = parseFloat(document.getElementById('wcfd-cell-size').value) || 5;
        this.domainSettings.maxCells = parseFloat(document.getElementById('wcfd-max-cells').value) || 3;
        this.domainSettings.refinementMin = parseInt(document.getElementById('wcfd-refine-min').value) || 1;
        this.domainSettings.refinementMax = parseInt(document.getElementById('wcfd-refine-max').value) || 2;
        this.domainSettings.iterations = parseInt(document.getElementById('wcfd-iterations').value) || 400;
        
        console.log('[WindCFD] Настройки CFD применены:', this.domainSettings);
        
        // Визуальное подтверждение
        const btn = document.getElementById('wcfd-apply-settings');
        btn.textContent = '✓ Применено!';
        btn.style.background = '#4CAF50';
        btn.style.color = 'white';
        setTimeout(() => {
            btn.textContent = '✓ Применить настройки';
            btn.style.background = '';
            btn.style.color = '';
        }, 1500);
    }
    
    onSliceHeightChange(value) {
        this.sliceHeight = parseFloat(value);
        const sliceValueEl = document.getElementById('wcfd-slice-value');
        if (sliceValueEl) {
            sliceValueEl.textContent = `${this.sliceHeight.toFixed(2)} м`;
        }
        
        // Обновляем позицию overlay если он есть
        if (this.windOverlay) {
            this.windOverlay.position.z = this.sliceHeight;
            this.updateHeightLabel();
        }
        // v2.1: Для векторного поля нужно пересоздавать, т.к. стрелки имеют абсолютные координаты
        // При быстром изменении слайдера просто обновляем позицию группы (визуальный эффект)
        // Реальный пересчёт будет при нажатии "Пересчитать срез"
        if (this.vectorField) {
            // Вычисляем разницу от исходной высоты
            const originalZ = this.windData?.slice_height || 1.75;
            const deltaZ = this.sliceHeight - originalZ;
            this.vectorField.position.z = deltaZ;
        }
    }
    
    show() {
        this.panel.classList.remove('hidden');
        this.updateBuildingsInfo();
        this.loadCachedDirections();  // Обновляем кеш при открытии
    }
    
    hide() {
        this.panel.classList.add('hidden');
        this.hideDomain();
        this.hideWindArrow();
    }
    
    // ==================== Выбор зданий ====================
    
    startBuildingSelection() {
        alert('Выберите здания на сцене (Shift+клик для множественного выбора), затем нажмите "Применить выбор"');
        const btn = document.getElementById('wcfd-select-buildings');
        btn.textContent = 'Применить выбор';
        btn.onclick = () => this.applyBuildingSelection();
    }
    
    applyBuildingSelection() {
        if (window.selectTool) {
            const selected = window.selectTool.getSelectedMultiple();
            if (selected.length > 0) {
                this.selectedBuildings = selected;
                this.updateBuildingsInfo();
                this.updateDomain();
            } else {
                alert('Не выбрано ни одного здания');
            }
        }
        
        const btn = document.getElementById('wcfd-select-buildings');
        btn.textContent = 'Выбрать здания';
        btn.onclick = () => this.startBuildingSelection();
    }
    
    updateBuildingsInfo() {
        const info = document.getElementById('wcfd-buildings-info');
        if (this.selectedBuildings.length === 0) {
            info.textContent = 'Не выбрано';
        } else {
            const heights = this.selectedBuildings.map(m => m.userData.properties?.height || 9);
            const maxH = Math.max(...heights);
            info.innerHTML = `<strong>${this.selectedBuildings.length}</strong> зданий<br>Макс. высота: <strong>${maxH.toFixed(1)} м</strong>`;
        }
        this.updateCalculateButtons();
    }
    
    // ==================== Домен ====================
    
    updateDomain() {
        this.hideDomain();
        
        if (this.selectedBuildings.length === 0) {
            document.getElementById('wcfd-domain-info').textContent = '—';
            return;
        }
        
        const bbox = new THREE.Box3();
        this.selectedBuildings.forEach(mesh => bbox.expandByObject(mesh));
        
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const bboxCenter = new THREE.Vector3();
        bbox.getCenter(bboxCenter);
        
        const maxHeight = size.z;
        const H = maxHeight;
        
        // Отступы как на сервере
        const inlet = H * this.domainSettings.inletFactor;   // 3H
        const outlet = H * this.domainSettings.outletFactor; // 6H  
        const lateral = H * this.domainSettings.lateralFactor; // 2.5H
        const domainHeight = H * this.domainSettings.heightFactor; // 5H
        
        // Визуализация: показываем средний размер
        // По направлению ветра: inlet + outlet = 9H, по бокам: lateral*2 = 5H
        // Берём максимум для симметричного отображения
        const margin = Math.max(inlet + lateral, outlet + lateral) / 2;
        
        const domainWidth = size.x + margin * 2;
        const domainDepth = size.y + margin * 2;
        
        this.domainParams = {
            center: bboxCenter.clone(),
            width: domainWidth,
            depth: domainDepth,
            height: domainHeight,
            buildingsBbox: bbox.clone(),
            maxHeight: maxHeight
        };
        
        document.getElementById('wcfd-domain-info').innerHTML = `
            <strong>${domainWidth.toFixed(0)} × ${domainDepth.toFixed(0)} × ${domainHeight.toFixed(0)}</strong> м<br>
            H = ${maxHeight.toFixed(0)}м | Зданий: ${size.x.toFixed(0)} × ${size.y.toFixed(0)}м<br>
            <span style="font-size: 11px; color: #888;">
                Сервер: inlet=${inlet.toFixed(0)}, outlet=${outlet.toFixed(0)}, lateral=${lateral.toFixed(0)}м
            </span>
        `;
        
        if (this.domainVisible) this.showDomain();
    }
    
    showDomain() {
        if (!this.domainParams) return;
        this.hideDomain();
        
        const { center, width, depth, height } = this.domainParams;
        const geometry = new THREE.BoxGeometry(width, depth, height);
        const edges = new THREE.EdgesGeometry(geometry);
        const material = new THREE.LineBasicMaterial({ color: 0x4a90e2, transparent: true, opacity: 0.7 });
        
        this.domainMesh = new THREE.LineSegments(edges, material);
        this.domainMesh.position.set(center.x, center.y, height / 2);
        this.sceneManager.scene.add(this.domainMesh);
    }
    
    hideDomain() {
        if (this.domainMesh) {
            this.sceneManager.scene.remove(this.domainMesh);
            this.domainMesh.geometry.dispose();
            this.domainMesh.material.dispose();
            this.domainMesh = null;
        }
    }
    
    toggleDomain(visible) {
        this.domainVisible = visible;
        if (visible) {
            this.showDomain();
            if (this.selectedDirection !== null) {
                this.updateWindArrow();
            }
        } else {
            this.hideDomain();
            this.hideWindArrow();
        }
    }
    
    // ==================== v2.1: Стрелка направления ветра ====================
    
    updateWindArrow() {
        this.hideWindArrow();
        
        if (!this.domainParams || this.selectedDirection === null || this.selectedSpeed === null) return;
        
        const { center, width, depth, height } = this.domainParams;
        
        // Метеорологическое направление: откуда дует ветер
        const windAngleRad = this.selectedDirection * Math.PI / 180;
        
        // Вектор направления (куда дует, противоположно метео)
        const dirX = -Math.sin(windAngleRad);
        const dirY = -Math.cos(windAngleRad);
        
        // Позиция стрелки - на границе домена со стороны откуда дует
        const arrowLength = Math.min(width, depth) * 0.25;
        const startX = center.x + Math.sin(windAngleRad) * (width / 2 - arrowLength * 0.3);
        const startY = center.y + Math.cos(windAngleRad) * (depth / 2 - arrowLength * 0.3);
        const startZ = height * 0.7;
        
        const dir = new THREE.Vector3(dirX, dirY, 0).normalize();
        const origin = new THREE.Vector3(startX, startY, startZ);
        
        this.windArrow = new THREE.ArrowHelper(dir, origin, arrowLength, 0xff6600, arrowLength * 0.3, arrowLength * 0.15);
        this.sceneManager.scene.add(this.windArrow);
        
        // Создаём текстовую метку
        this.createWindArrowLabel(origin);
    }
    
    createWindArrowLabel(origin) {
        const oldLabel = document.getElementById('wcfd-wind-arrow-label');
        if (oldLabel) oldLabel.remove();
        
        const label = document.createElement('div');
        label.id = 'wcfd-wind-arrow-label';
        label.style.cssText = `
            position: absolute;
            background: rgba(255, 102, 0, 0.9);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            pointer-events: none;
            white-space: nowrap;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            z-index: 1000;
        `;
        
        const dirNames = {0: 'С', 45: 'СВ', 90: 'В', 135: 'ЮВ', 180: 'Ю', 225: 'ЮЗ', 270: 'З', 315: 'СЗ'};
        const dirName = dirNames[this.selectedDirection] || `${this.selectedDirection}°`;
        label.textContent = `${dirName} ${this.selectedSpeed.toFixed(1)} м/с`;
        
        document.body.appendChild(label);
        this.windArrowLabel = label;
        
        // Увеличиваем ID чтобы старые loops остановились
        this.windArrowLoopId++;
        const currentLoopId = this.windArrowLoopId;
        
        // Обновляем позицию метки при рендере
        const updateLabelPos = () => {
            // Проверяем что это актуальный loop и объекты ещё существуют
            if (currentLoopId !== this.windArrowLoopId) return; // Старый loop — выходим
            if (!this.windArrow || !this.windArrowLabel) return;
            
            const canvas = this.sceneManager.renderer.domElement;
            const pos = origin.clone();
            pos.z += 5;
            
            const vector = pos.project(this.sceneManager.camera);
            const x = (vector.x * 0.5 + 0.5) * canvas.clientWidth;
            const y = (-vector.y * 0.5 + 0.5) * canvas.clientHeight;
            
            this.windArrowLabel.style.left = `${x}px`;
            this.windArrowLabel.style.top = `${y - 30}px`;
            this.windArrowLabel.style.transform = 'translateX(-50%)';
            
            requestAnimationFrame(updateLabelPos);
        };
        updateLabelPos();
    }
    
    hideWindArrow() {
        // Останавливаем старый loop
        this.windArrowLoopId++;
        
        if (this.windArrow) {
            this.sceneManager.scene.remove(this.windArrow);
            // ArrowHelper не имеет dispose, очищаем вручную
            if (this.windArrow.line) {
                this.windArrow.line.geometry.dispose();
                this.windArrow.line.material.dispose();
            }
            if (this.windArrow.cone) {
                this.windArrow.cone.geometry.dispose();
                this.windArrow.cone.material.dispose();
            }
            this.windArrow = null;
        }
        const label = document.getElementById('wcfd-wind-arrow-label');
        if (label) label.remove();
        this.windArrowLabel = null;
    }
    
    // ==================== EPW ====================
    
    loadEPW() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.epw';
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (evt) => this.parseEPW(evt.target.result, file.name);
            reader.readAsText(file);
        };
        
        input.click();
    }
    
    parseEPW(content, filename) {
        const lines = content.split('\n');
        const data = { filename, location: '', speeds: [], directions: [] };
        
        if (lines.length > 0) {
            const header = lines[0].split(',');
            if (header.length > 1) data.location = header[1];
        }
        
        for (let i = 8; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const values = line.split(',');
            if (values.length < 22) continue;
            
            const direction = parseFloat(values[20]);
            const speed = parseFloat(values[21]);
            
            if (!isNaN(speed) && !isNaN(direction)) {
                data.directions.push(direction % 360);
                data.speeds.push(speed);
            }
        }
        
        if (data.speeds.length === 0) {
            alert('Не удалось прочитать данные из EPW файла');
            return;
        }
        
        // Рассчитываем статистику скоростей
        const sortedSpeeds = [...data.speeds].sort((a, b) => a - b);
        data.meanSpeed = sortedSpeeds.reduce((a, b) => a + b, 0) / sortedSpeeds.length;
        data.maxSpeed = sortedSpeeds[sortedSpeeds.length - 1];
        data.p95Speed = sortedSpeeds[Math.floor(sortedSpeeds.length * 0.95)];
        data.p99Speed = sortedSpeeds[Math.floor(sortedSpeeds.length * 0.99)];
        
        data.sectors = this.analyzeSectors(data, 8);
        this.epwData = data;
        
        this.updateEPWInfo();
        this.renderWindRose();
        this.updateCalculateButtons();
    }
    
    analyzeSectors(data, numSectors) {
        const sectorSize = 360 / numSectors;
        const sectors = Array.from({ length: numSectors }, () => ({ directions: [], speeds: [] }));
        
        for (let j = 0; j < data.directions.length; j++) {
            const idx = Math.floor((data.directions[j] + sectorSize / 2) / sectorSize) % numSectors;
            sectors[idx].speeds.push(data.speeds[j]);
        }
        
        const names = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
        const angles = [0, 45, 90, 135, 180, 225, 270, 315];
        
        return sectors.map((s, i) => {
            const sortedSpeeds = [...s.speeds].sort((a, b) => a - b);
            const p95Index = Math.floor(sortedSpeeds.length * 0.95);
            
            return {
                name: names[i],
                angle: angles[i],
                count: s.speeds.length,
                frequency: (s.speeds.length / data.speeds.length) * 100,
                meanSpeed: s.speeds.length > 0 ? s.speeds.reduce((a, b) => a + b, 0) / s.speeds.length : 0,
                p95Speed: sortedSpeeds.length > 0 ? sortedSpeeds[p95Index] || sortedSpeeds[sortedSpeeds.length - 1] : 0,
                maxSpeed: sortedSpeeds.length > 0 ? sortedSpeeds[sortedSpeeds.length - 1] : 0
            };
        });
    }
    
    updateEPWInfo() {
        const info = document.getElementById('wcfd-epw-info');
        if (!this.epwData) {
            info.textContent = 'Файл не загружен';
            return;
        }
        
        info.innerHTML = `
            <strong>${this.epwData.location || this.epwData.filename}</strong><br>
            ${this.epwData.speeds.length} записей<br>
            <div style="margin-top: 8px;">
                <label>Скорость ветра:</label>
                <select id="wcfd-speed-preset" style="width: 100%; margin-top: 4px; padding: 4px;">
                    <option value="mean">Средняя (по секторам)</option>
                    <option value="p95">Порывы 95% (по секторам)</option>
                    <option value="p99">Экстремум 99% (глобальный): ${this.epwData.p99Speed.toFixed(1)} м/с</option>
                    <option value="max">Максимум (по секторам)</option>
                    <option value="custom">Вручную...</option>
                </select>
                <input type="number" id="wcfd-speed-custom" style="width: 100%; margin-top: 4px; padding: 4px; display: none;" 
                       placeholder="Скорость м/с" min="0.1" max="50" step="0.1">
            </div>
        `;
        
        // Устанавливаем начальную скорость
        this.speedType = 'mean';
        this.selectedSpeed = this.epwData.meanSpeed;
        
        // Обработчики
        const select = document.getElementById('wcfd-speed-preset');
        const customInput = document.getElementById('wcfd-speed-custom');
        
        select.onchange = () => {
            const val = select.value;
            this.speedType = val;
            
            if (val === 'custom') {
                customInput.style.display = 'block';
                customInput.value = this.selectedSpeed.toFixed(1);
            } else {
                customInput.style.display = 'none';
                // Пересчитываем скорость для текущего направления
                this.updateSpeedForCurrentDirection();
            }
            console.log(`[WindCFD] Speed type: ${this.speedType}, speed: ${this.selectedSpeed.toFixed(1)} m/s`);
            this.updateWindArrow();
            this.updateSelectedWindInfo();
        };
        
        customInput.onchange = () => {
            const val = parseFloat(customInput.value);
            if (!isNaN(val) && val > 0) {
                this.selectedSpeed = val;
                this.speedType = 'custom';
                console.log(`[WindCFD] Custom speed: ${this.selectedSpeed.toFixed(1)} m/s`);
                this.updateWindArrow();
                this.updateSelectedWindInfo();
            }
        };
    }
    
    updateSelectedWindInfo() {
        const info = document.getElementById('wcfd-selected-wind');
        if (!info || this.selectedDirection === null) return;
        
        const sector = this.epwData?.sectors?.find(s => s.angle === this.selectedDirection);
        if (sector) {
            info.innerHTML = `
                Направление: <strong>${sector.name} (${sector.angle}°)</strong><br>
                Скорость: <strong>${this.selectedSpeed.toFixed(1)} м/с</strong>
            `;
        }
    }
    
    updateSpeedForCurrentDirection() {
        // Пересчитываем скорость на основе типа и текущего направления
        if (!this.epwData) return;
        
        const sector = this.epwData.sectors?.find(s => s.angle === this.selectedDirection);
        
        switch (this.speedType) {
            case 'mean':
                // Средняя для текущего сектора
                this.selectedSpeed = sector ? sector.meanSpeed : this.epwData.meanSpeed;
                break;
            case 'p95':
                // 95 перцентиль для текущего сектора
                this.selectedSpeed = sector?.p95Speed || this.epwData.p95Speed;
                break;
            case 'p99':
                // Глобальный 99 перцентиль (редкие экстремумы)
                this.selectedSpeed = this.epwData.p99Speed;
                break;
            case 'max':
                // Максимум для текущего сектора
                this.selectedSpeed = sector?.maxSpeed || this.epwData.maxSpeed;
                break;
            case 'custom':
                // Не меняем - используем введённое значение
                break;
        }
    }
    
    renderWindRose() {
        const container = document.getElementById('wcfd-wind-rose');
        container.innerHTML = '';
        
        if (!this.epwData?.sectors) return;
        
        document.getElementById('wcfd-direction-section').classList.remove('wcfd-hidden');
        
        this.epwData.sectors.forEach((sector, i) => {
            const btn = document.createElement('button');
            btn.className = 'wcfd-wind-btn';
            btn.dataset.angle = sector.angle;
            
            // Проверяем есть ли результат для этого направления (включая кешированные)
            if (this.results[sector.angle]) {
                btn.classList.add('calculated');
            }
            
            btn.innerHTML = `
                <div class="dir">${sector.name}</div>
                <div class="speed">${sector.meanSpeed.toFixed(1)} м/с</div>
                <div class="speed">${sector.frequency.toFixed(0)}%</div>
            `;
            btn.onclick = () => this.selectWindDirection(i, btn);
            container.appendChild(btn);
        });
        
        // Обновляем секцию результатов если есть рассчитанные
        const calculatedCount = Object.keys(this.results).length;
        if (calculatedCount > 0) {
            this.updateResultsSection();
        }
    }
    
    async selectWindDirection(index, btn) {
        document.querySelectorAll('.wcfd-wind-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const sector = this.epwData.sectors[index];
        this.selectedDirection = sector.angle;
        
        // Пересчитываем скорость для нового направления на основе типа
        this.updateSpeedForCurrentDirection();
        
        document.getElementById('wcfd-selected-wind').innerHTML = `
            Направление: <strong>${sector.name} (${sector.angle}°)</strong><br>
            Скорость: <strong>${this.selectedSpeed.toFixed(1)} м/с</strong>
        `;
        
        // v2.1: Обновляем стрелку направления
        this.updateWindArrow();
        this.updateCalculateButtons();
        
        // Проверяем есть ли результат
        const result = this.results[sector.angle];
        
        if (result) {
            // Если данные ещё не загружены - загружаем с сервера
            if (!result.data) {
                console.log(`[WindCFD] Загрузка данных для ${sector.angle}°...`);
                const data = await this.loadDirectionData(sector.angle);
                if (data) {
                    this.results[sector.angle] = {
                        data: data,
                        speed: sector.meanSpeed,
                        case_dir: data.case_dir,
                        case_name: data.case_name
                    };
                }
            }
            
            // Показываем результат
            if (this.results[sector.angle]?.data) {
                this.showDirectionResult(sector.angle);
            } else {
                console.warn(`[WindCFD] Нет данных для ${sector.angle}°`);
            }
        }
    }
    
    rotateDomain(windAngle) {
        if (!this.domainMesh || !this.domainParams) return;
        const angleRad = (windAngle - 90) * Math.PI / 180;
        this.domainMesh.rotation.z = -angleRad;
    }
    
    updateCalculateButtons() {
        const btn = document.getElementById('wcfd-calculate');
        const btnAll = document.getElementById('wcfd-calculate-all');
        
        const canCalculate = this.selectedBuildings.length > 0 && 
                            this.selectedDirection !== null &&
                            this.selectedSpeed !== null;
        
        const canCalculateAll = this.selectedBuildings.length > 0 && this.epwData?.sectors;
        
        // Проверяем есть ли уже результат для этого направления
        if (this.results[this.selectedDirection]) {
            btn.textContent = 'Пересчитать';
        } else {
            btn.textContent = 'Запустить расчёт';
        }
        
        btn.disabled = !canCalculate || this.isCalculating;
        btnAll.disabled = !canCalculateAll || this.isCalculating;
        
        // Обновляем текст кнопки "все направления"
        if (canCalculateAll) {
            const pending = this.epwData.sectors.filter(s => !this.results[s.angle] || this.results[s.angle].cached).length;
            btnAll.textContent = `🔄 Рассчитать все направления (${pending} из 8)`;
            if (pending === 0) {
                btnAll.disabled = true;
            }
        }
    }
    
    // ==================== Пакетный расчёт ====================
    
    async calculateAllDirections() {
        if (this.isCalculating) {
            alert('Расчёт уже выполняется');
            return;
        }
        
        if (!this.epwData?.sectors || this.selectedBuildings.length === 0) {
            alert('Сначала выберите здания и загрузите EPW файл');
            return;
        }
        
        // Определяем какие направления ещё не рассчитаны
        const pendingDirections = this.epwData.sectors.filter(s => !this.results[s.angle] || this.results[s.angle].cached);
        
        if (pendingDirections.length === 0) {
            alert('Все направления уже рассчитаны');
            return;
        }
        
        const confirmMsg = `Запустить расчёт для ${pendingDirections.length} направлений?\n\n` +
            pendingDirections.map(s => `${s.name} (${s.angle}°) - ${s.meanSpeed.toFixed(1)} м/с`).join('\n') +
            `\n\nПримерное время: ${pendingDirections.length * 2}-${pendingDirections.length * 3} минут`;
        
        if (!confirm(confirmMsg)) return;
        
        // Запускаем пакетный режим
        this.batchMode = true;
        this.batchQueue = [...pendingDirections];
        this.batchTotal = pendingDirections.length;
        this.batchCompleted = 0;
        
        this.showBatchProgress();
        this.processNextInQueue();
    }
    
    showBatchProgress() {
        const section = document.getElementById('wcfd-results-section');
        section.classList.remove('wcfd-hidden');
        section.innerHTML = `
            <div class="wcfd-batch-progress">
                <div class="wcfd-label">Пакетный расчёт</div>
                <div class="wcfd-batch-status" id="wcfd-batch-status">Подготовка...</div>
                <div class="wcfd-batch-bar-container">
                    <div class="wcfd-batch-bar" id="wcfd-batch-bar" style="width: 0%"></div>
                </div>
                <div class="wcfd-batch-details" id="wcfd-batch-details"></div>
                <button class="wcfd-btn wcfd-btn-danger" id="wcfd-batch-stop">⏹ Остановить</button>
            </div>
        `;
        document.getElementById('wcfd-batch-stop').onclick = () => this.stopBatchCalculation();
    }
    
    updateBatchProgress(currentSector, status) {
        const statusEl = document.getElementById('wcfd-batch-status');
        const barEl = document.getElementById('wcfd-batch-bar');
        const detailsEl = document.getElementById('wcfd-batch-details');
        
        if (statusEl) {
            statusEl.textContent = `${currentSector.name} (${currentSector.angle}°): ${status}`;
        }
        
        if (barEl) {
            const progress = ((this.batchCompleted) / this.batchTotal) * 100;
            barEl.style.width = `${progress}%`;
        }
        
        if (detailsEl) {
            let html = '';
            this.epwData.sectors.forEach(s => {
                let cls = 'pending';
                let icon = '⏳';
                const result = this.results[s.angle];
                if (result && !result.cached) {
                    cls = 'done';
                    icon = '✅';
                } else if (currentSector && s.angle === currentSector.angle) {
                    cls = 'active';
                    icon = '🔄';
                }
                html += `<div class="wcfd-batch-item ${cls}">
                    <span>${icon} ${s.name} (${s.angle}°)</span>
                    <span>${s.meanSpeed.toFixed(1)} м/с</span>
                </div>`;
            });
            detailsEl.innerHTML = html;
        }
    }
    
    async processNextInQueue() {
        if (!this.batchMode || this.batchQueue.length === 0) {
            this.finishBatchCalculation();
            return;
        }
        
        const sector = this.batchQueue.shift();
        this.selectedDirection = sector.angle;
        
        // Пересчитываем скорость для этого направления на основе типа
        this.updateSpeedForCurrentDirection();
        
        // Обновляем UI
        document.querySelectorAll('.wcfd-wind-btn').forEach(btn => {
            btn.classList.remove('active');
            if (parseInt(btn.dataset.angle) === sector.angle) {
                btn.classList.add('active');
            }
        });
        
        this.updateBatchProgress(sector, 'Подготовка...');
        
        try {
            const geojson = this.exportBuildingsGeoJSON();
            const cfdConfig = {
                buildings: geojson,
                domain: this.domainParams,
                wind: { direction: sector.angle, speed: this.selectedSpeed },
                settings: {
                    iterations: this.domainSettings.iterations,
                    cellSize: this.domainSettings.cellSize,
                    sampleHeight: this.sliceHeight,
                    // Параметры домена
                    inletFactor: this.domainSettings.inletFactor,
                    outletFactor: this.domainSettings.outletFactor,
                    lateralFactor: this.domainSettings.lateralFactor,
                    heightFactor: this.domainSettings.heightFactor,
                    // Параметры сетки
                    refinementMin: this.domainSettings.refinementMin,
                    refinementMax: this.domainSettings.refinementMax,
                    maxCells: this.domainSettings.maxCells
                }
            };
            
            this.isCalculating = true;
            this.pollingStopped = false;
            
            const response = await this._fetch(`${this.serverUrl}/calculate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cfdConfig)
            });
            
            if (!response.ok) throw new Error('Сервер вернул ошибку');
            
            // Ждём завершения
            await this.waitForBatchCompletion(sector);
            
        } catch (err) {
            console.error(`[WindCFD] Ошибка ${sector.name}:`, err);
            this.updateBatchProgress(sector, `Ошибка: ${err.message}`);
            setTimeout(() => this.processNextInQueue(), 2000);
        }
    }
    
    async waitForBatchCompletion(sector) {
        return new Promise((resolve) => {
            const poll = async () => {
                if (!this.batchMode) {
                    resolve();
                    return;
                }
                
                try {
                    const resp = await this._fetch(`${this.serverUrl}/status`);
                    const status = await resp.json();
                    
                    this.updateBatchProgress(sector, status.message || 'Расчёт...');
                    
                    // Обновляем прогресс-бар с учётом прогресса текущего расчёта
                    const barEl = document.getElementById('wcfd-batch-bar');
                    if (barEl) {
                        const baseProgress = (this.batchCompleted / this.batchTotal) * 100;
                        const currentProgress = (status.progress / 100) * (100 / this.batchTotal);
                        barEl.style.width = `${baseProgress + currentProgress}%`;
                    }
                    
                    if (status.status === 'completed') {
                        const resultResp = await this._fetch(`${this.serverUrl}/result`);
                        const result = await resultResp.json();
                        
                        // Сохраняем с полными метаданными
                        this.results[sector.angle] = { 
                            data: result, 
                            speed: sector.meanSpeed,
                            case_dir: result.case_dir,
                            case_name: result.case_name
                        };
                        this.batchCompleted++;
                        this.isCalculating = false;
                        
                        // Обновляем розу ветров (НЕ вызываем updateResultsSection!)
                        this.renderWindRose();
                        
                        // В batch mode НЕ показываем результат - только обновляем прогресс
                        // showDirectionResult вызовет updateResultsSection и сломает batch UI
                        this.updateBatchProgress(sector, '✅ Готово');
                        
                        console.log(`[WindCFD] ✅ ${sector.name} (${this.batchCompleted}/${this.batchTotal})`);
                        
                        // Переходим к следующему
                        setTimeout(() => this.processNextInQueue(), 1000);
                        resolve();
                        
                    } else if (status.status === 'error') {
                        throw new Error(status.message);
                    } else {
                        setTimeout(poll, 2000);
                    }
                } catch (e) {
                    console.error('[WindCFD] Poll error:', e);
                    setTimeout(poll, 3000);
                }
            };
            poll();
        });
    }
    
    stopBatchCalculation() {
        this.batchMode = false;
        this.batchQueue = [];
        this.isCalculating = false;
        this._fetch(`${this.serverUrl}/stop`, { method: 'POST' }).catch(() => {});
        this.updateResultsSection();
        this.updateCalculateButtons();
        console.log('[WindCFD] Пакетный расчёт остановлен');
    }
    
    finishBatchCalculation() {
        this.batchMode = false;
        this.isCalculating = false;
        
        const completed = Object.values(this.results).filter(r => r && !r.cached).length;
        console.log(`[WindCFD] ✅ Пакетный расчёт завершён: ${completed}/8`);
        
        // Показываем последний рассчитанный результат
        const calculatedAngles = Object.keys(this.results)
            .map(k => parseInt(k))
            .filter(angle => this.results[angle] && !this.results[angle].cached);
        
        if (calculatedAngles.length > 0) {
            const lastAngle = calculatedAngles[calculatedAngles.length - 1];
            this.showDirectionResult(lastAngle);
        } else {
            this.updateResultsSection();
        }
        
        this.updateCalculateButtons();
        
        if (completed === 8) {
            alert('✅ Все 8 направлений рассчитаны!\n\nТеперь можно запустить анализ ветрового комфорта.');
        } else if (completed >= 4) {
            alert(`✅ Рассчитано ${completed}/8 направлений.\n\nМинимум для анализа комфорта достигнут!`);
        }
    }
    
    // ==================== Расчёт ====================
    
    async startCalculation() {
        if (this.isCalculating) return;
        this.isCalculating = true;
            this.pollingStopped = false;
        
        const progress = document.getElementById('wcfd-progress');
        const progressText = document.getElementById('wcfd-progress-text');
        const calcBtn = document.getElementById('wcfd-calculate');
        
        progress.classList.remove('hidden');
        calcBtn.disabled = true;
        
        try {
            progressText.textContent = 'Подготовка геометрии...';
            const geojson = this.exportBuildingsGeoJSON();
            
            progressText.textContent = 'Генерация CFD кейса...';
            await this.sleep(300);
            
            const cfdConfig = {
                buildings: geojson,
                domain: this.domainParams,
                wind: {
                    direction: this.selectedDirection,
                    speed: this.selectedSpeed
                },
                settings: {
                    iterations: this.domainSettings.iterations,
                    cellSize: this.domainSettings.cellSize,
                    sampleHeight: this.sliceHeight,
                    // Параметры домена
                    inletFactor: this.domainSettings.inletFactor,
                    outletFactor: this.domainSettings.outletFactor,
                    lateralFactor: this.domainSettings.lateralFactor,
                    heightFactor: this.domainSettings.heightFactor,
                    // Параметры сетки
                    refinementMin: this.domainSettings.refinementMin,
                    refinementMax: this.domainSettings.refinementMax,
                    maxCells: this.domainSettings.maxCells
                }
            };
            
            this.currentConfig = cfdConfig;
            await this.sendToServer(cfdConfig);
            
        } catch (err) {
            alert('Ошибка: ' + err.message);
            console.error(err);
            this.isCalculating = false;
            progress.classList.add('hidden');
            calcBtn.disabled = false;
        }
    }
    
    async sendToServer(config) {
        // Показываем фиксированную секцию прогресса
        this.showCalcProgress(config.wind.direction);
        
        try {
            const response = await this._fetch(`${this.serverUrl}/calculate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            
            if (!response.ok) {
                throw new Error('Сервер вернул ошибку ' + response.status);
            }
            
            const result = await response.json();
            console.log('[WindCFD] Server response:', result);
            
            this.pollStatus();
            
        } catch (error) {
            console.error('[WindCFD] Ошибка:', error);
            this.updateCalcProgress({ message: 'Сервер недоступен. Убедитесь что cfd_server.py запущен.', progress: 0 });
            this.isCalculating = false;
        }
    }
    
    showCalcProgress(direction) {
        const section = document.getElementById('wcfd-calc-progress-section');
        section.classList.remove('wcfd-hidden');
        
        const info = document.getElementById('wcfd-calc-progress-info');
        info.textContent = `Направление: ${direction}°`;
        
        const bar = document.getElementById('wcfd-calc-progress-bar');
        bar.style.width = '0%';
        
        const iter = document.getElementById('wcfd-calc-progress-iter');
        iter.textContent = 'Подключение к серверу...';
    }
    
    updateCalcProgress(status) {
        const bar = document.getElementById('wcfd-calc-progress-bar');
        const iter = document.getElementById('wcfd-calc-progress-iter');
        
        if (bar) bar.style.width = (status.progress || 0) + '%';
        if (iter) {
            if (status.iteration && status.total_iterations) {
                iter.textContent = `Итерация: ${status.iteration} / ${status.total_iterations}`;
            } else {
                iter.textContent = status.message || '...';
            }
        }
    }
    
    hideCalcProgress() {
        // Не скрываем если расчёт ещё идёт
        if (this.isCalculating) {
            console.log('[WindCFD] hideCalcProgress skipped - calculation in progress');
            return;
        }
        const section = document.getElementById('wcfd-calc-progress-section');
        if (section) section.classList.add('wcfd-hidden');
    }
    
    forceHideCalcProgress() {
        // Принудительное скрытие (для завершения/ошибки)
        const section = document.getElementById('wcfd-calc-progress-section');
        if (section) section.classList.add('wcfd-hidden');
    }
    
    async pollStatus() {
        // Проверяем флаг остановки
        if (this.pollingStopped) {
            console.log('[WindCFD] Polling остановлен');
            return;
        }
        
        try {
            const resp = await this._fetch(`${this.serverUrl}/status`);
            const status = await resp.json();
            
            // Обновляем фиксированную секцию прогресса
            this.updateCalcProgress(status);
            
            if (status.status === 'queued' || status.status === 'running') {
                setTimeout(() => this.pollStatus(), 2000);
            } else if (status.status === 'completed') {
                try {
                    const resultResp = await this._fetch(`${this.serverUrl}/result`);
                    const result = await resultResp.json();
                    
                    // Проверяем на ошибку в результате
                    if (result.error) {
                        throw new Error(result.error);
                    }
                    
                    // Проверяем наличие данных
                    if (!result.grid || !result.grid.values) {
                        throw new Error('Пустой результат от сервера');
                    }
                    
                    // Сохраняем результат для направления
                    this.saveDirectionResult(this.selectedDirection, result);
                    
                    this.pollingStopped = true;
                    this.isCalculating = false;
                    this.hideCalcProgress();
                    
                    const progressEl = document.getElementById('wcfd-progress');
                    if (progressEl) progressEl.classList.add('hidden');
                    const calcBtn = document.getElementById('wcfd-calculate');
                    if (calcBtn) calcBtn.disabled = false;
                    this.updateCalculateButtons();
                    
                } catch (resultError) {
                    console.error('[WindCFD] Result error:', resultError);
                    this.updateCalcProgress({ message: 'Ошибка: ' + resultError.message, progress: 0 });
                    this.isCalculating = false;
                }
                
            } else if (status.status === 'error') {
                this.updateCalcProgress({ message: 'Ошибка: ' + status.message, progress: 0 });
                this.pollingStopped = true;
                this.isCalculating = false;
            }
        } catch (e) {
            console.error('[WindCFD] Poll error:', e);
        }
    }
    
    async stopCalculation() {
        try {
            await this._fetch(`${this.serverUrl}/stop`, { method: 'POST' });
            this.updateCalcProgress({ message: 'Остановлен', progress: 0 });
            this.pollingStopped = true;
            this.isCalculating = false;
            
            // Скрываем прогресс через 2 секунды
            setTimeout(() => this.hideCalcProgress(), 2000);
            
            const progressEl = document.getElementById('wcfd-progress');
            if (progressEl) progressEl.classList.add('hidden');
            const calcBtn = document.getElementById('wcfd-calculate');
            if (calcBtn) calcBtn.disabled = false;
            this.updateCalculateButtons();
        } catch (e) {
            console.error('[WindCFD] Stop error:', e);
        }
    }
    
    exportBuildingsGeoJSON() {
        const features = [];
        
        this.selectedBuildings.forEach(mesh => {
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
    
    // ==================== Результаты по направлениям ====================
    
    saveDirectionResult(angle, data) {
        console.log(`[WindCFD] Сохраняем результат для направления ${angle}°`);
        console.log(`[WindCFD] data.case_dir:`, data.case_dir);
        console.log(`[WindCFD] data.case_name:`, data.case_name);
        
        // Скрываем текущий overlay
        this.hideCurrentOverlay();
        
        // Сохраняем данные с полными метаданными
        this.results[angle] = {
            data: data,
            speed: this.selectedSpeed,
            case_dir: data.case_dir,
            case_name: data.case_name
        };
        
        // Обновляем розу ветров - отмечаем рассчитанное направление
        this.renderWindRose();
        
        // Показываем результат
        this.showDirectionResult(angle);
        
        // Обновляем секцию результатов
        this.updateResultsSection();
    }
    
    showDirectionResult(angle) {
        console.log(`[WindCFD] Показываем результат для направления ${angle}°`);
        console.log(`[WindCFD] Текущий activeDirection: ${this.activeDirection}`);
        console.log(`[WindCFD] results keys:`, Object.keys(this.results));
        
        // Скрываем текущий overlay
        this.hideCurrentOverlay();
        
        const result = this.results[angle];
        console.log(`[WindCFD] result для ${angle}:`, result ? 'есть' : 'нет', result?.data ? 'data есть' : 'data нет');
        if (!result || !result.data) {
            console.warn(`[WindCFD] Нет результата для направления ${angle}°`);
            return;
        }
        
        this.selectedDirection = angle;
        this.selectedSpeed = result.data.wind_speed || result.speed || 4.0;
        
        this.activeDirection = angle;
        this.renderWindOverlay(result.data);
        this.updateResultsSection();
        
        // Обновляем стрелку направления
        this.updateWindArrow();
    }
    
    hideCurrentOverlay() {
        if (this.windOverlay) {
            this.sceneManager.scene.remove(this.windOverlay);
            if (this.windOverlay.material.map) {
                this.windOverlay.material.map.dispose();
            }
            this.windOverlay.material.dispose();
            this.windOverlay.geometry.dispose();
            this.windOverlay = null;
        }
        
        // v2.1: Скрываем векторное поле
        this.hideVectorField();
        
        // Останавливаем анимацию потоков
        this.stopFlowAnimationIfRunning();
        
        this.activeDirection = null;
        
        // Удаляем метку высоты
        const label = document.getElementById('wcfd-3d-height-label');
        if (label) label.remove();
    }
    
    updateResultsSection() {
        const section = document.getElementById('wcfd-results-section');
        const vectorSection = document.getElementById('wcfd-vector-settings-section');
        const validResults = Object.values(this.results).filter(r => r && !r.cached);
        const count = validResults.length;
        
        if (count === 0) {
            section.classList.add('wcfd-hidden');
            if (vectorSection) vectorSection.classList.add('wcfd-hidden');
            return;
        }
        
        section.classList.remove('wcfd-hidden');
        if (vectorSection) vectorSection.classList.remove('wcfd-hidden');
        
        // Проверяем достаточно ли направлений для анализа комфорта
        const canAnalyzeComfort = count >= 4 && this.epwData?.sectors;
        
        section.innerHTML = `
            <div class="wcfd-label">Результаты</div>
            <div class="wcfd-results-count">
                Рассчитано: <strong>${count}/8</strong>
                ${this.activeDirection !== null ? ` | Показано: <strong>${this.activeDirection}°</strong>` : ''}
            </div>
            
            <!-- v2.1: Режим отображения -->
            <div class="wcfd-label" style="margin-top: 8px;">Режим отображения:</div>
            <div class="wcfd-mode-buttons">
                <button class="wcfd-mode-btn ${this.displayMode === 'gradient' ? 'active' : ''}" data-mode="gradient">🎨 Градиент</button>
                <button class="wcfd-mode-btn ${this.displayMode === 'vectors' ? 'active' : ''}" data-mode="vectors">➡️ Векторы</button>
                <button class="wcfd-mode-btn ${this.displayMode === 'both' ? 'active' : ''}" data-mode="both">🎨➡️ Оба</button>
            </div>
            <div class="wcfd-vector-settings ${this.displayMode === 'gradient' ? 'wcfd-hidden' : ''}" id="wcfd-vector-settings">
                <div class="wcfd-slice-header">
                    <span>Плотность:</span>
                    <span class="wcfd-slice-value" id="wcfd-density-value">${this.vectorDensity}</span>
                </div>
                <input type="range" id="wcfd-density-slider" min="10" max="200" step="5" value="${this.vectorDensity}">
                <div class="wcfd-slice-header">
                    <span>Масштаб:</span>
                    <span class="wcfd-slice-value" id="wcfd-scale-value">${this.vectorScale}x</span>
                </div>
                <input type="range" id="wcfd-scale-slider" min="1" max="10" step="0.5" value="${this.vectorScale}">
            </div>
            
            <div class="wcfd-slice-control" id="wcfd-slice-control">
                <div class="wcfd-slice-header">
                    <span>Высота сечения:</span>
                    <span class="wcfd-slice-value" id="wcfd-slice-value">${this.sliceHeight.toFixed(2)} м</span>
                </div>
                <input type="range" id="wcfd-slice-slider" min="0.5" max="50" step="0.25" value="${this.sliceHeight}">
                <button class="wcfd-btn" id="wcfd-resample">🔄 Пересчитать срез</button>
            </div>
            <div class="wcfd-legend" id="wcfd-legend"></div>
            
            <!-- ==================== Wind Comfort Analysis ==================== -->
            ${canAnalyzeComfort ? `
            <div class="wcfd-comfort-section" style="margin-top: 12px; padding-top: 12px; border-top: 2px solid #4a90e2;">
                <div class="wcfd-label" style="color: #4a90e2;">🌬️ Анализ ветрового комфорта</div>
                
                <div style="margin-bottom: 10px;">
                    <label style="font-size: 12px; display: block; margin-bottom: 4px;">Стандарт:</label>
                    <select id="wcfd-comfort-standard" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #ddd;">
                        <option value="lawson" ${this.comfortSettings.standard === 'lawson' ? 'selected' : ''}>Lawson LDDC (UK)</option>
                        <option value="nen8100" ${this.comfortSettings.standard === 'nen8100' ? 'selected' : ''}>NEN 8100 (NL)</option>
                    </select>
                </div>
                
                <div style="margin-bottom: 10px;">
                    <label style="font-size: 12px; display: block; margin-bottom: 4px;">Скорость ветра для анализа:</label>
                    <select id="wcfd-comfort-speed-source" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #ddd;">
                        <option value="gem" ${this.comfortSettings.speedSource === 'gem' ? 'selected' : ''}>GEM (Mean×2.0) — рекомендуется</option>
                        <option value="p95" ${this.comfortSettings.speedSource === 'p95' ? 'selected' : ''}>P95 из EPW (более строгий)</option>
                        <option value="max" ${this.comfortSettings.speedSource === 'max' ? 'selected' : ''}>Максимум из EPW (очень строгий)</option>
                        <option value="cfd" ${this.comfortSettings.speedSource === 'cfd' ? 'selected' : ''}>Прямо из CFD (debug)</option>
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
            ` : count < 4 ? `
            <div style="margin-top: 12px; padding: 10px; background: #fff3cd; border-radius: 6px; font-size: 12px;">
                ⚠️ Для анализа комфорта нужно минимум 4 направления (сейчас: ${count})
            </div>
            ` : ''}
            
            <button class="wcfd-btn" id="wcfd-hide-results" style="margin-top: 10px;">Скрыть результаты</button>
            <button class="wcfd-btn" id="wcfd-export-results">Экспорт JSON</button>
            <button class="wcfd-btn" id="wcfd-download-paraview">📦 Paraview (${this.activeDirection !== null ? this.activeDirection + '°' : '—'})</button>
            <button class="wcfd-btn wcfd-btn-danger" id="wcfd-clear-all">Очистить все расчёты</button>
        `;
        
        this.renderLegend();
        
        // Привязываем события
        document.getElementById('wcfd-hide-results').onclick = () => this.hideCurrentOverlay();
        document.getElementById('wcfd-export-results').onclick = () => this.exportResults();
        document.getElementById('wcfd-download-paraview').onclick = () => this.downloadParaview();
        document.getElementById('wcfd-clear-all').onclick = () => this.clearAllResults();
        document.getElementById('wcfd-slice-slider').oninput = (e) => this.onSliceHeightChange(e.target.value);
        document.getElementById('wcfd-resample').onclick = () => this.resampleSlice();
        
        // v2.1: Режим отображения
        document.querySelectorAll('.wcfd-mode-btn').forEach(btn => {
            btn.onclick = () => this.setDisplayMode(btn.dataset.mode);
        });
        
        // v2.1: Настройки векторов
        const densitySlider = document.getElementById('wcfd-density-slider');
        const scaleSlider = document.getElementById('wcfd-scale-slider');
        
        if (densitySlider) {
            densitySlider.oninput = (e) => {
                this.vectorDensity = parseInt(e.target.value);
                document.getElementById('wcfd-density-value').textContent = this.vectorDensity;
                this.updateVectorField();
            };
        }
        
        if (scaleSlider) {
            scaleSlider.oninput = (e) => {
                this.vectorScale = parseFloat(e.target.value);
                document.getElementById('wcfd-scale-value').textContent = `${this.vectorScale}x`;
                this.updateVectorField();
            };
        }
        
        // ==================== Comfort Analysis Events ====================
        const comfortStandard = document.getElementById('wcfd-comfort-standard');
        const comfortSpeedSource = document.getElementById('wcfd-comfort-speed-source');
        const calcComfortBtn = document.getElementById('wcfd-calc-comfort');
        const hideComfortBtn = document.getElementById('wcfd-hide-comfort');
        const exportComfortBtn = document.getElementById('wcfd-export-comfort');
        
        if (comfortStandard) {
            comfortStandard.onchange = (e) => {
                this.comfortSettings.standard = e.target.value;
                this.updateComfortInfo();
            };
        }
        
        if (comfortSpeedSource) {
            comfortSpeedSource.onchange = (e) => {
                this.comfortSettings.speedSource = e.target.value;
                this.updateComfortInfo();
            };
        }
        
        if (calcComfortBtn) {
            calcComfortBtn.onclick = () => this.calculateWindComfort();
        }
        
        if (hideComfortBtn) {
            hideComfortBtn.onclick = () => this.hideComfortOverlay();
        }
        
        if (exportComfortBtn) {
            exportComfortBtn.onclick = () => this.exportComfortData();
        }
    }
    
    // Обновление описания стандарта комфорта
    updateComfortInfo() {
        const info = document.getElementById('wcfd-comfort-info');
        if (!info) return;
        
        const count = Object.values(this.results).filter(r => r && !r.cached).length;
        
        let speedDesc = '';
        switch (this.comfortSettings.speedSource) {
            case 'gem':
                speedDesc = 'GEM = Mean × 2.0 (стандартный метод)';
                break;
            case 'p95':
                speedDesc = 'P95 скорости из EPW (строгий)';
                break;
            case 'max':
                speedDesc = 'Максимальные скорости из EPW (очень строгий)';
                break;
            case 'cfd':
                speedDesc = 'Напрямую из CFD (только для отладки)';
                break;
        }
        
        if (this.comfortSettings.standard === 'lawson') {
            info.innerHTML = `
                <strong>Lawson LDDC:</strong> P(превышение) < 5%<br>
                <strong>Скорость:</strong> ${speedDesc}<br>
                <strong>Формула:</strong> V = K × V<sub>EPW</sub><br>
                <strong>Используется:</strong> ${count} из 8 направлений
            `;
        } else {
            info.innerHTML = `
                <strong>NEN 8100:</strong> P(U > 5 м/с)<br>
                <strong>Скорость:</strong> ${speedDesc}<br>
                <strong>Формула:</strong> V = K × V<sub>EPW</sub><br>
                <strong>Используется:</strong> ${count} из 8 направлений
            `;
        }
    }
    
    // v2.1: Смена режима отображения
    setDisplayMode(mode) {
        this.displayMode = mode;
        
        // Обновляем UI кнопок
        document.querySelectorAll('.wcfd-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        
        // Показываем/скрываем настройки векторов
        const vectorSettings = document.getElementById('wcfd-vector-settings');
        if (vectorSettings) {
            vectorSettings.classList.toggle('wcfd-hidden', mode === 'gradient');
        }
        
        // Перерисовываем если есть данные
        if (this.activeDirection !== null && this.results[this.activeDirection]?.data) {
            this.hideCurrentOverlay();
            this.activeDirection = this.selectedDirection;
            this.renderWindOverlay(this.results[this.activeDirection].data);
        }
    }
    
    // ==================== Отрисовка результатов ====================
    
    renderWindOverlay(data) {
        // Проверка данных
        if (!data || !data.grid) {
            console.error('[WindCFD] Нет данных для отображения');
            return;
        }
        
        const grid = data.grid;
        
        // Проверка обязательных полей
        if (!grid.values || !Array.isArray(grid.values) || grid.values.length === 0) {
            console.error('[WindCFD] Некорректные данные grid.values');
            return;
        }
        
        const nx = grid.nx || grid.values[0]?.length || 0;
        const ny = grid.ny || grid.values.length || 0;
        const spacing = grid.spacing || 2;
        const origin = grid.origin || [0, 0];
        
        if (nx === 0 || ny === 0) {
            console.error('[WindCFD] Пустая сетка данных');
            return;
        }
        
        console.log(`[WindCFD] Отрисовка: ${nx}x${ny}, spacing=${spacing}, origin=[${origin}]`);
        
        // Определяем диапазон скоростей из реальных данных grid
        let maxSpeed = 0;
        for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
                const v = grid.values[iy]?.[ix] ?? 0;
                if (v > maxSpeed) maxSpeed = v;
            }
        }
        this.speedRange = { min: 0, max: maxSpeed > 0.1 ? maxSpeed : 5 };
        
        console.log(`[WindCFD] Speed range (from grid): 0 - ${this.speedRange.max.toFixed(2)} m/s`);
        
        // v2.1: Рендерим в зависимости от режима
        if (this.displayMode === 'gradient' || this.displayMode === 'both') {
            this.renderGradientOverlay(data);
        }
        
        if (this.displayMode === 'vectors' || this.displayMode === 'both') {
            this.renderVectorField(data);
        }
        
        this.windData = data;
        
        // Добавляем метку высоты
        this.updateHeightLabel();
        
        if (!this.clickHandlerAdded) {
            this.sceneManager.renderer.domElement.addEventListener('click', (e) => this.onResultClick(e));
            this.clickHandlerAdded = true;
        }
    }
    
    // v2.1: Отрисовка градиентного overlay
    renderGradientOverlay(data) {
        const grid = data.grid;
        const nx = grid.nx || grid.values[0]?.length || 0;
        const ny = grid.ny || grid.values.length || 0;
        const spacing = grid.spacing || 2;
        const origin = grid.origin || [0, 0];
        
        if (nx === 0 || ny === 0) return;
        
        // Увеличиваем разрешение текстуры для чёткости (до 1024)
        const scale = Math.min(8, Math.floor(1024 / Math.max(nx, ny)));
        const texWidth = nx * scale;
        const texHeight = ny * scale;
        
        const canvas = document.createElement('canvas');
        canvas.width = texWidth;
        canvas.height = texHeight;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(texWidth, texHeight);
        
        // Бикубическая интерполяция для более плавного градиента
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
            return grid.values[iy]?.[ix] ?? 0;
        };
        
        const bicubicInterp = (gx, gy) => {
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
        };
        
        for (let ty = 0; ty < texHeight; ty++) {
            for (let tx = 0; tx < texWidth; tx++) {
                const gx = tx / scale;
                const gy = ty / scale;
                
                // Бикубическая интерполяция
                const speed = bicubicInterp(gx, gy);
                
                const color = this.getColorForSpeed(speed);
                const idx = ((texHeight - 1 - ty) * texWidth + tx) * 4;
                imageData.data[idx] = color[0];
                imageData.data[idx + 1] = color[1];
                imageData.data[idx + 2] = color[2];
                imageData.data[idx + 3] = this.displayMode === 'both' ? 150 : 220;
            }
        }
        ctx.putImageData(imageData, 0, 0);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        
        const width = nx * spacing;
        const height = ny * spacing;
        
        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: this.displayMode === 'both' ? 0.7 : 0.85,
            side: THREE.DoubleSide
        });
        
        this.windOverlay = new THREE.Mesh(geometry, material);
        this.windOverlay.position.set(origin[0] + width/2, origin[1] + height/2, this.sliceHeight);
        
        this.sceneManager.scene.add(this.windOverlay);
    }
    
    // v2.1: Отрисовка векторного поля
    renderVectorField(data) {
        this.hideVectorField();
        
        const grid = data.grid;
        const nx = grid.nx || grid.values[0]?.length || 0;
        const ny = grid.ny || grid.values.length || 0;
        const spacing = grid.spacing || 2;
        const origin = grid.origin || [0, 0];
        
        if (nx === 0 || ny === 0) return;
        
        // Шаг выборки - отдельно по X и Y
        const stepX = Math.max(1, Math.floor(nx / this.vectorDensity));
        const stepY = Math.max(1, Math.floor(ny / this.vectorDensity));
        
        this.vectorField = new THREE.Group();
        this.vectorArrows = [];
        
        // Направление ветра
        const windAngleRad = (this.activeDirection || 0) * Math.PI / 180;
        const baseVx = -Math.sin(windAngleRad);
        const baseVy = -Math.cos(windAngleRad);
        
        for (let iy = 0; iy < ny; iy += stepY) {
            for (let ix = 0; ix < nx; ix += stepX) {
                const speed = grid.values[iy]?.[ix] ?? 0;
                if (speed < 0.1) continue;
                
                const x = origin[0] + ix * spacing;
                const y = origin[1] + iy * spacing;
                
                // Компоненты скорости (если есть в данных, иначе используем направление ветра)
                const vx = grid.vx?.[iy]?.[ix] ?? baseVx * speed;
                const vy = grid.vy?.[iy]?.[ix] ?? baseVy * speed;
                
                const velMag = Math.sqrt(vx * vx + vy * vy);
                if (velMag < 0.1) continue;
                
                const dir = new THREE.Vector3(vx / velMag, vy / velMag, 0);
                const pos = new THREE.Vector3(x, y, this.sliceHeight + 0.2);
                
                // Длина пропорциональна скорости
                const arrowLength = (speed / this.speedRange.max) * spacing * this.vectorScale;
                
                // Цвет по скорости
                const color = this.getColorForSpeed(speed);
                const hexColor = (color[0] << 16) | (color[1] << 8) | color[2];
                
                // ArrowHelper: direction, origin, length, color, headLength, headWidth
                const arrow = new THREE.ArrowHelper(dir, pos, arrowLength, hexColor, arrowLength * 0.35, arrowLength * 0.25);
                this.vectorField.add(arrow);
                this.vectorArrows.push(arrow);
            }
        }
        
        this.sceneManager.scene.add(this.vectorField);
        this.vectorField.position.set(0, 0, 0);
        console.log(`[WindCFD] Создано ${this.vectorArrows.length} векторов (density=${this.vectorDensity}, scale=${this.vectorScale})`);
    }
    
    // v2.1: Скрытие векторного поля
    hideVectorField() {
        if (this.vectorField) {
            // ArrowHelper не имеет метода dispose(), удаляем вручную
            this.vectorArrows.forEach(arrow => {
                // ArrowHelper содержит line и cone
                if (arrow.line) {
                    arrow.line.geometry?.dispose();
                    arrow.line.material?.dispose();
                }
                if (arrow.cone) {
                    arrow.cone.geometry?.dispose();
                    arrow.cone.material?.dispose();
                }
            });
            this.sceneManager.scene.remove(this.vectorField);
            this.vectorField = null;
            this.vectorArrows = [];
        }
    }
    
    // v2.1: Обновление векторного поля
    updateVectorField() {
        if ((this.displayMode === 'vectors' || this.displayMode === 'both') && 
            this.activeDirection !== null && this.results[this.activeDirection]?.data) {
            this.hideVectorField();
            this.renderVectorField(this.results[this.activeDirection].data);
        }
    }
    
    getColorForSpeed(speed) {
        // Плавная интерполяция цветов как в Paraview
        const { min, max } = this.speedRange;
        
        // Нормализуем скорость в диапазон 0-1
        let t = (speed - min) / (max - min);
        t = Math.max(0, Math.min(1, t));
        
        // Находим два соседних цвета для интерполяции
        const scale = this.colorScale;
        let i = 0;
        while (i < scale.length - 1 && scale[i + 1].t < t) {
            i++;
        }
        
        if (i >= scale.length - 1) {
            return scale[scale.length - 1].color;
        }
        
        const c1 = scale[i];
        const c2 = scale[i + 1];
        
        // Интерполяция между двумя цветами
        const localT = (t - c1.t) / (c2.t - c1.t);
        
        return [
            Math.round(c1.color[0] + (c2.color[0] - c1.color[0]) * localT),
            Math.round(c1.color[1] + (c2.color[1] - c1.color[1]) * localT),
            Math.round(c1.color[2] + (c2.color[2] - c1.color[2]) * localT)
        ];
    }
    
    renderLegend() {
        const container = document.getElementById('wcfd-legend');
        if (!container) return;
        
        const { min, max } = this.speedRange;
        
        // Создаём градиентную легенду
        container.innerHTML = `
            <div class="wcfd-gradient-legend">
                <div class="wcfd-gradient-bar"></div>
                <div class="wcfd-gradient-labels">
                    <span>${min.toFixed(1)}</span>
                    <span>${((min + max) / 2).toFixed(1)}</span>
                    <span>${max.toFixed(1)} м/с</span>
                </div>
            </div>
        `;
    }
    
    onResultClick(event) {
        if (!this.windOverlay || !this.windData) return;
        
        const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.sceneManager.camera);
        
        const intersects = raycaster.intersectObject(this.windOverlay);
        if (intersects.length > 0) {
            const point = intersects[0].point;
            const grid = this.windData.grid;
            
            const ix = Math.floor((point.x - grid.origin[0]) / grid.spacing);
            const iy = Math.floor((point.y - grid.origin[1]) / grid.spacing);
            
            if (ix >= 0 && ix < grid.nx && iy >= 0 && iy < grid.ny) {
                const speed = grid.values[iy]?.[ix] || 0;
                this.showSpeedTooltip(event.clientX, event.clientY, speed);
            }
        }
    }
    
    showSpeedTooltip(x, y, speed) {
        let tooltip = document.getElementById('wcfd-speed-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'wcfd-speed-tooltip';
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
        tooltip.innerHTML = `<b>${speed.toFixed(2)} м/с</b>`;
        tooltip.style.left = (x + 15) + 'px';
        tooltip.style.top = (y + 15) + 'px';
        tooltip.style.display = 'block';
        
        clearTimeout(this.tooltipTimer);
        this.tooltipTimer = setTimeout(() => tooltip.style.display = 'none', 2500);
    }
    
    // ==================== Paraview ====================
    
    async downloadParaview() {
        console.log("[WindCFD] downloadParaview called");
        console.log("[WindCFD] activeDirection:", this.activeDirection);
        console.log("[WindCFD] selectedDirection:", this.selectedDirection);
        console.log("[WindCFD] results:", Object.keys(this.results));
        console.log("[WindCFD] case_dirs in results:", Object.entries(this.results).map(([k,v]) => `${k}: ${v?.case_dir || 'no case_dir'}`));
        
        const direction = this.activeDirection ?? this.selectedDirection;
        if (direction === null) {
            alert('Сначала выберите направление и дождитесь завершения расчёта');
            return;
        }
        
        // Проверяем есть ли результат для этого направления
        if (!this.results[direction]) {
            alert(`Нет результата для направления ${direction}°. Сначала выполните расчёт.`);
            return;
        }
        
        try {
            // Запрашиваем информацию для конкретного направления
            const resp = await this._fetch(`${this.serverUrl}/paraview/${direction}`);
            
            if (!resp.ok) {
                const err = await resp.json();
                alert('Ошибка: ' + (err.error || 'Кейс не найден'));
                return;
            }
            
            const info = await resp.json();
            console.log('[WindCFD] Paraview info:', info);
            
            // Показываем модальное окно с информацией
            this.showParaviewModal(info);
            
        } catch (error) {
            console.error('[WindCFD] Paraview error:', error);
            alert('Ошибка подключения к серверу. Убедитесь что cfd_server.py запущен.');
        }
    }
    
    showParaviewModal(info) {
        const existing = document.getElementById('wcfd-paraview-modal');
        if (existing) existing.remove();
        
        const modal = document.createElement('div');
        modal.id = 'wcfd-paraview-modal';
        modal.innerHTML = `
            <div class="wcfd-modal-backdrop"></div>
            <div class="wcfd-modal-content">
                <div class="wcfd-modal-header">
                    <h3>📦 Экспорт для Paraview</h3>
                    <button class="wcfd-modal-close">×</button>
                </div>
                <div class="wcfd-modal-body">
                    <p><strong>Направление:</strong> ${info.wind_direction}°</p>
                    <p><strong>Кейс:</strong> ${info.case_name}</p>
                    
                    <div style="margin: 15px 0;">
                        <p style="font-weight: 600; margin-bottom: 8px;">Вариант 1: Открыть напрямую</p>
                        <p style="font-size: 13px; color: #666;">В Paraview: File → Open → вставьте путь:</p>
                        <div class="wcfd-command-box">
                            <code id="wcfd-wsl-path">${info.wsl_path}\\${info.foam_file}</code>
                            <button class="wcfd-copy-btn" id="wcfd-copy-wsl">📋</button>
                        </div>
                    </div>
                    
                    <div style="margin: 15px 0;">
                        <p style="font-weight: 600; margin-bottom: 8px;">Вариант 2: Скачать архив</p>
                        <button class="wcfd-btn wcfd-btn-primary" id="wcfd-download-zip" style="margin-top: 8px;">
                            ⬇️ Скачать ${info.case_name}.zip
                        </button>
                    </div>
                    
                    <p class="wcfd-note" style="margin-top: 15px;">
                        После открытия в Paraview выберите "OpenFOAM" reader,<br>
                        затем нажмите Apply и выберите поле U для визуализации.
                    </p>
                </div>
                <div class="wcfd-modal-footer">
                    <button class="wcfd-btn" id="wcfd-paraview-close">Закрыть</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.addModalStyles();
        
        // События
        modal.querySelector('.wcfd-modal-close').onclick = () => modal.remove();
        modal.querySelector('.wcfd-modal-backdrop').onclick = () => modal.remove();
        modal.querySelector('#wcfd-paraview-close').onclick = () => modal.remove();
        
        modal.querySelector('#wcfd-copy-wsl').onclick = () => {
            const text = document.getElementById('wcfd-wsl-path').textContent;
            navigator.clipboard.writeText(text).then(() => {
                const btn = modal.querySelector('#wcfd-copy-wsl');
                btn.textContent = '✓';
                setTimeout(() => btn.textContent = '📋', 2000);
            });
        };
        
        modal.querySelector('#wcfd-download-zip').onclick = async () => {
            const btn = modal.querySelector('#wcfd-download-zip');
            btn.disabled = true;
            btn.textContent = '⏳ Создание архива...';
            
            try {
                const response = await this._fetch(`${this.serverUrl}/download_paraview/${info.wind_direction}`);
                if (!response.ok) throw new Error('Ошибка скачивания');
                
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${info.case_name}_${info.wind_direction}deg_paraview.zip`;
                a.click();
                URL.revokeObjectURL(url);
                
                btn.textContent = '✅ Скачано!';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.textContent = `⬇️ Скачать ${info.case_name}.zip`;
                }, 2000);
                
            } catch (error) {
                console.error('[WindCFD] Download error:', error);
                btn.textContent = '❌ Ошибка';
                btn.disabled = false;
            }
        };
    }
    
    addModalStyles() {
        if (document.getElementById('wcfd-modal-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'wcfd-modal-styles';
        style.textContent = `
            #wcfd-command-modal, #wcfd-paraview-modal {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .wcfd-modal-backdrop {
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.5);
            }
            .wcfd-modal-content {
                position: relative;
                background: white;
                border-radius: 12px;
                width: 90%;
                max-width: 500px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            }
            .wcfd-modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                border-bottom: 1px solid #eee;
            }
            .wcfd-modal-header h3 { margin: 0; font-size: 18px; }
            .wcfd-modal-close {
                background: none;
                border: none;
                font-size: 28px;
                cursor: pointer;
                color: #999;
            }
            .wcfd-modal-body { padding: 20px; }
            .wcfd-modal-body p { margin: 0 0 12px 0; }
            .wcfd-command-box {
                background: #1e1e1e;
                border-radius: 8px;
                padding: 12px;
                margin: 12px 0;
                position: relative;
            }
            .wcfd-command-box code {
                display: block;
                color: #4ec9b0;
                font-family: 'Consolas', 'Monaco', monospace;
                font-size: 12px;
                word-break: break-all;
                padding-right: 80px;
            }
            .wcfd-copy-btn {
                position: absolute;
                top: 8px; right: 8px;
                background: #333;
                border: 1px solid #555;
                color: white;
                padding: 4px 10px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
            }
            .wcfd-note { font-size: 13px; color: #666; font-style: italic; }
            .wcfd-modal-footer {
                padding: 16px 20px;
                border-top: 1px solid #eee;
                text-align: right;
            }
        `;
        document.head.appendChild(style);
    }
    
    // ==================== Управление высотой сечения ====================
    
    async resampleSlice() {
        const resampleBtn = document.getElementById('wcfd-resample');
        if (!resampleBtn) {
            console.error('[WindCFD] Resample button not found');
            return;
        }
        
        console.log('[WindCFD] resampleSlice called');
        console.log('[WindCFD] activeDirection:', this.activeDirection);
        console.log('[WindCFD] sliceHeight:', this.sliceHeight);
        console.log('[WindCFD] serverUrl:', this.serverUrl);
        
        if (this.activeDirection === null) {
            alert('Сначала выберите направление');
            return;
        }
        
        resampleBtn.disabled = true;
        resampleBtn.textContent = '⏳ Пересчёт...';
        
        const requestBody = {
            z: this.sliceHeight,
            direction: this.activeDirection
        };
        console.log('[WindCFD] Request body:', JSON.stringify(requestBody));
        
        try {
            const url = `${this.serverUrl}/resample`;
            console.log('[WindCFD] Fetching:', url);
            
            const response = await this._fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            
            console.log('[WindCFD] Response status:', response.status);
            console.log('[WindCFD] Response ok:', response.ok);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('[WindCFD] Response error text:', errorText);
                throw new Error(`Ошибка пересчёта: ${response.status} - ${errorText}`);
            }
            
            const result = await response.json();
            console.log(`[WindCFD] Пересчитан срез на высоте ${this.sliceHeight}м`);
            console.log('[WindCFD] Result grid:', result.grid ? `${result.grid.nx}x${result.grid.ny}` : 'no grid');
            console.log('[WindCFD] Result stats:', result.stats);
            
            // Обновляем данные для текущего направления
            if (this.activeDirection !== null && this.results[this.activeDirection]) {
                this.results[this.activeDirection].data = result;
            }
            
            // Перерисовываем overlay
            const directionToShow = this.activeDirection;
            this.hideCurrentOverlay();
            this.activeDirection = directionToShow;
            this.renderWindOverlay(result);
            
            resampleBtn.textContent = '✅ Готово!';
            setTimeout(() => {
                resampleBtn.disabled = false;
                resampleBtn.textContent = '🔄 Пересчитать срез';
            }, 1500);
            
        } catch (error) {
            console.error('[WindCFD] Resample error:', error);
            console.error('[WindCFD] Error name:', error.name);
            console.error('[WindCFD] Error message:', error.message);
            resampleBtn.textContent = '❌ Ошибка';
            setTimeout(() => {
                resampleBtn.disabled = false;
                resampleBtn.textContent = '🔄 Пересчитать срез';
            }, 2000);
            
            alert(`Ошибка пересчёта: ${error.message}`);
        }
    }
    
    updateHeightLabel() {
        // Удаляем старую метку
        let label = document.getElementById('wcfd-3d-height-label');
        if (label) label.remove();
        
        if (!this.windOverlay && !this.vectorField) return;
        
        // Создаём HTML метку
        label = document.createElement('div');
        label.id = 'wcfd-3d-height-label';
        label.className = 'wcfd-height-label';
        label.textContent = `Z = ${this.sliceHeight.toFixed(2)} м`;
        document.body.appendChild(label);
        
        // Обновляем позицию метки при рендере
        this.updateLabelPosition();
    }
    
    updateLabelPosition() {
        const label = document.getElementById('wcfd-3d-height-label');
        if (!label) return;
        
        const overlay = this.windOverlay || this.vectorField;
        if (!overlay) return;
        
        // Получаем угол overlay для позиционирования метки
        const pos = overlay.position.clone();
        pos.z = this.sliceHeight + 2; // Немного выше плоскости
        
        // Проецируем 3D координаты на экран
        const canvas = this.sceneManager.renderer.domElement;
        const vector = pos.project(this.sceneManager.camera);
        
        const x = (vector.x * 0.5 + 0.5) * canvas.clientWidth;
        const y = (-vector.y * 0.5 + 0.5) * canvas.clientHeight;
        
        label.style.left = `${x}px`;
        label.style.top = `${y}px`;
        label.style.transform = 'translate(-50%, -100%)';
    }
    
    // ==================== Очистка ====================
    
    async clearServerCache() {
        if (!confirm('Удалить все расчёты CFD на сервере? Это удалит все case_ директории.')) return;
        
        try {
            const resp = await this._fetch(`${this.serverUrl}/cleanup`, { method: 'POST' });
            const data = await resp.json();
            console.log('[WindCFD] Сервер очищен:', data);
            
            // Очищаем локальный кеш
            this.results = {};
            this.hideCurrentOverlay();
            this.renderWindRose();
            this.updateCalculateButtons();
            
            const resultsSection = document.getElementById('wcfd-results-section');
            if (resultsSection) resultsSection.classList.add('wcfd-hidden');
            
            alert(`Удалено ${data.deleted || 0} расчётов`);
        } catch (e) {
            console.error('[WindCFD] Ошибка очистки:', e);
            alert('Ошибка подключения к серверу');
        }
    }

    async clearAllResults() {
        if (!confirm('Удалить все результаты на сервере и локально?')) return;
        
        // Скрываем текущий overlay
        this.hideCurrentOverlay();
        
        // Очищаем хранилище
        this.results = {};
        
        // Обновляем UI
        this.renderWindRose();
        document.getElementById('wcfd-results-section').classList.add('wcfd-hidden');
        this.updateCalculateButtons();
        
        // Очищаем на сервере
        try {
            await this._fetch(`${this.serverUrl}/cleanup`, { method: 'POST' });
            console.log('[WindCFD] Сервер очищен');
        } catch (e) {
            console.warn('[WindCFD] Ошибка очистки сервера:', e);
        }
        
        console.log('[WindCFD] Все результаты очищены');
    }
    
    exportResults() {
        if (this.activeDirection === null) {
            alert('Сначала выберите направление');
            return;
        }
        
        const result = this.results[this.activeDirection];
        if (!result || !result.data) {
            alert('Нет данных для экспорта');
            return;
        }
        
        const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wind_${this.activeDirection}deg.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    // ==================== Загрузка результатов ====================
    
    loadResults(jsonData) {
        const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
        
        if (!data.grid || !data.grid.values) {
            throw new Error('Неверный формат данных');
        }
        
        // Если есть направление в данных — используем его
        const angle = data.wind_direction ?? this.selectedDirection ?? 0;
        this.saveDirectionResult(angle, data);
    }
    
    // ==================== Utils ====================
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // ==================== Wind Comfort Analysis ====================
    
    /**
     * Главный метод расчёта ветрового комфорта
     * 
     * МЕТОДОЛОГИЯ (Amplification Factor):
     * 1. K = V_cfd / V_input — коэффициент усиления
     * 2. V_real = K × V_climate — реальная скорость (P95 из EPW)
     * 3. P(exceed) = Σ(freq × I(V_real > threshold))
     * 
     * Lawson LDDC: Категория = лучшая где P(exceed) < 5%
     * NEN 8100: Категория по P(U > 5 м/с)
     */
    calculateWindComfort() {
        console.log('[WindCFD] Calculating wind comfort with amplification factor method...');
        
        // Проверяем наличие данных
        const validResults = Object.entries(this.results).filter(([_, r]) => r && r.data && r.data.grid);
        if (validResults.length < 4) {
            alert(`Недостаточно данных. Рассчитано ${validResults.length}/8 направлений. Минимум 4.`);
            return;
        }
        
        if (!this.epwData?.sectors) {
            alert('Нет данных EPW. Загрузите файл EPW.');
            return;
        }
        
        const btn = document.getElementById('wcfd-calc-comfort');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Расчёт...';
        }
        
        try {
            // Берём первый результат как reference для сетки
            const refResult = validResults[0][1].data;
            const grid = refResult.grid;
            const nx = grid.nx;
            const ny = grid.ny;
            
            // Определяем источник климатической скорости
            const speedSource = this.comfortSettings.speedSource || 'p95';
            console.log(`[WindCFD] Speed source: ${speedSource}`);
            
            // Пороги Lawson (м/с)
            const lawsonThresholds = [
                { key: 'sitting_long', threshold: 2.5 },
                { key: 'sitting_short', threshold: 4.0 },
                { key: 'standing', threshold: 6.0 },
                { key: 'walking', threshold: 8.0 },
                { key: 'uncomfortable', threshold: 10.0 },
                { key: 'dangerous', threshold: Infinity }
            ];
            
            // Создаём массивы для комфорта
            const comfortGrid = Array(ny).fill(null).map(() => Array(nx).fill(0));
            const categoryGrid = Array(ny).fill(null).map(() => Array(nx).fill('A'));
            const exceedGrid = Array(ny).fill(null).map(() => Array(nx).fill(0));
            
            // Считаем общую частоту рассчитанных направлений для нормализации
            let totalCoverage = 0;
            for (const [angleStr, _] of validResults) {
                const angle = parseInt(angleStr);
                const sector = this.epwData.sectors.find(s => s.angle === angle);
                if (sector) totalCoverage += sector.frequency;
            }
            console.log(`[WindCFD] Direction coverage: ${totalCoverage.toFixed(1)}% of wind hours`);
            
            // Собираем метаданные для каждого направления
            const directionMeta = {};
            for (const [angleStr, result] of validResults) {
                const angle = parseInt(angleStr);
                const sector = this.epwData.sectors.find(s => s.angle === angle);
                if (!sector) continue;
                
                // Входная скорость CFD (из EPW mean при расчёте)
                const inputSpeed = result.data.wind_speed || result.speed || sector.meanSpeed;
                
                // Климатическая скорость для анализа комфорта
                let climateSpeed;
                switch (speedSource) {
                    case 'p95':
                        // P95 скорость из EPW (реальные порывы)
                        climateSpeed = sector.p95Speed || inputSpeed * 2.5;
                        break;
                    case 'gem':
                        // GEM = inputSpeed × 2.0 (Gust Equivalent Mean)
                        // Используем inputSpeed чтобы K × climateSpeed = V_cfd × 2.0
                        climateSpeed = inputSpeed * 2.0;
                        break;
                    case 'max':
                        // Максимальная скорость из EPW
                        climateSpeed = sector.maxSpeed || inputSpeed * 3.5;
                        break;
                    case 'cfd':
                    default:
                        // Прямо из CFD (только для отладки)
                        climateSpeed = inputSpeed;
                }
                
                directionMeta[angle] = {
                    inputSpeed,
                    climateSpeed,
                    frequency: sector.frequency / totalCoverage, // Нормализованная частота
                    grid: result.data.grid.values
                };
                
                console.log(`[WindCFD] ${angle}°: input=${inputSpeed.toFixed(2)}, climate=${climateSpeed.toFixed(2)}, freq=${(sector.frequency).toFixed(1)}%`);
            }
            
            // Для каждой точки сетки
            for (let iy = 0; iy < ny; iy++) {
                for (let ix = 0; ix < nx; ix++) {
                    
                    // Собираем реальные скорости для всех направлений
                    const realSpeedFreqPairs = [];
                    let maxRealSpeed = 0;
                    let weightedRealSpeed = 0;
                    
                    for (const [angleStr, meta] of Object.entries(directionMeta)) {
                        const angle = parseInt(angleStr);
                        
                        // Скорость из CFD в этой точке
                        const vCfd = meta.grid[iy]?.[ix] ?? 0;
                        
                        // Коэффициент усиления K = V_cfd / V_input
                        const K = meta.inputSpeed > 0 ? vCfd / meta.inputSpeed : 1.0;
                        
                        // Реальная скорость V_real = K × V_climate
                        const vReal = K * meta.climateSpeed;
                        
                        realSpeedFreqPairs.push({ 
                            speed: vReal, 
                            frequency: meta.frequency,
                            K: K
                        });
                        
                        maxRealSpeed = Math.max(maxRealSpeed, vReal);
                        weightedRealSpeed += vReal * meta.frequency;
                    }
                    
                    // Сохраняем взвешенную скорость для визуализации
                    comfortGrid[iy][ix] = weightedRealSpeed;
                    
                    if (this.comfortSettings.standard === 'lawson') {
                        // === LAWSON: Вероятность превышения каждого порога ===
                        // Категория = лучшая, для которой P(exceed) < 5%
                        
                        let category = 'dangerous'; // Худшая по умолчанию
                        
                        for (const { key, threshold } of lawsonThresholds) {
                            if (threshold === Infinity) {
                                category = 'dangerous';
                                break;
                            }
                            
                            // P(U > threshold) = сумма частот где реальная скорость превышает порог
                            let pExceed = 0;
                            for (const { speed, frequency } of realSpeedFreqPairs) {
                                if (speed > threshold) {
                                    pExceed += frequency;
                                }
                            }
                            
                            // Если P(exceed) < 5%, эта категория ПОДХОДИТ
                            if (pExceed < 0.05) {
                                category = key;
                                break;
                            }
                        }
                        
                        categoryGrid[iy][ix] = category;
                        exceedGrid[iy][ix] = maxRealSpeed; // Макс. скорость для отладки
                        
                    } else {
                        // === NEN 8100: P(U > 5 м/с) ===
                        let pExceed5 = 0;
                        for (const { speed, frequency } of realSpeedFreqPairs) {
                            if (speed > 5.0) {
                                pExceed5 += frequency;
                            }
                        }
                        
                        exceedGrid[iy][ix] = pExceed5 * 100; // В процентах
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
            console.log('[WindCFD] Category distribution:', categoryCount);
            
            // Статистика скоростей
            const allSpeeds = comfortGrid.flat();
            console.log(`[WindCFD] Speed stats: min=${Math.min(...allSpeeds).toFixed(2)}, max=${Math.max(...allSpeeds).toFixed(2)}, mean=${(allSpeeds.reduce((a,b)=>a+b,0)/allSpeeds.length).toFixed(2)}`);
            
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
                standard: this.comfortSettings.standard,
                speedSource: speedSource,
                directionsCoverage: totalCoverage,
                directionsUsed: validResults.length,
                categoryDistribution: categoryCount,
                timestamp: new Date().toISOString()
            };
            
            // Скрываем текущий overlay направления
            this.hideCurrentOverlay();
            
            // Рендерим комфортный overlay
            this.renderComfortOverlay();
            
            // Показываем легенду и кнопки
            this.renderComfortLegend();
            
            const hideBtn = document.getElementById('wcfd-hide-comfort');
            const exportBtn = document.getElementById('wcfd-export-comfort');
            if (hideBtn) hideBtn.classList.remove('wcfd-hidden');
            if (exportBtn) exportBtn.classList.remove('wcfd-hidden');
            
            if (btn) {
                btn.textContent = '✅ Готово!';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.textContent = '📊 Рассчитать комфорт';
                }, 1500);
            }
            
            console.log('[WindCFD] Wind comfort calculation complete');
            
        } catch (error) {
            console.error('[WindCFD] Comfort calculation error:', error);
            alert('Ошибка расчёта: ' + error.message);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '📊 Рассчитать комфорт';
            }
        }
    }
    
    /**
     * Определяет категорию Lawson по скорости
     */
    getLawsonCategory(speed) {
        if (speed < 2.5) return 'sitting_long';
        if (speed < 4.0) return 'sitting_short';
        if (speed < 6.0) return 'standing';
        if (speed < 8.0) return 'walking';
        if (speed < 10.0) return 'uncomfortable';
        return 'dangerous';
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
     * Рендеринг overlay комфорта
     */
    renderComfortOverlay() {
        this.hideComfortOverlay();
        
        if (!this.comfortData?.grid) return;
        
        const grid = this.comfortData.grid;
        const nx = grid.nx;
        const ny = grid.ny;
        const spacing = grid.spacing;
        const origin = grid.origin;
        
        // Создаём canvas для текстуры
        const scale = Math.min(4, Math.floor(512 / Math.max(nx, ny)));
        const texWidth = nx * scale;
        const texHeight = ny * scale;
        
        const canvas = document.createElement('canvas');
        canvas.width = texWidth;
        canvas.height = texHeight;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(texWidth, texHeight);
        
        // Заполняем цветами категорий
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
                imageData.data[idx + 3] = 200; // Полупрозрачность
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter; // Чёткие границы категорий
        texture.minFilter = THREE.NearestFilter;
        
        const width = nx * spacing;
        const height = ny * spacing;
        
        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide
        });
        
        this.comfortOverlay = new THREE.Mesh(geometry, material);
        this.comfortOverlay.position.set(
            origin[0] + width / 2,
            origin[1] + height / 2,
            this.sliceHeight + 0.1
        );
        
        this.sceneManager.scene.add(this.comfortOverlay);
        this.comfortSettings.showComfort = true;
        
        console.log(`[WindCFD] Comfort overlay rendered: ${nx}x${ny}`);
    }
    
    /**
     * Получает цвет для категории комфорта
     */
    getComfortColor(category) {
        if (this.comfortSettings.standard === 'lawson') {
            return this.lawsonCriteria[category]?.color || [128, 128, 128];
        } else {
            return this.nen8100Criteria[category]?.color || [128, 128, 128];
        }
    }
    
    /**
     * Рендерит легенду комфорта
     */
    renderComfortLegend() {
        const container = document.getElementById('wcfd-comfort-legend');
        if (!container) return;
        
        container.classList.remove('wcfd-hidden');
        
        let html = '<div style="font-size: 12px; font-weight: 600; margin-bottom: 6px;">Категории комфорта:</div>';
        
        if (this.comfortSettings.standard === 'lawson') {
            html += '<div style="display: grid; gap: 4px;">';
            for (const [key, data] of Object.entries(this.lawsonCriteria)) {
                const rgb = data.color;
                html += `
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <div style="width: 20px; height: 14px; background: rgb(${rgb[0]},${rgb[1]},${rgb[2]}); border-radius: 2px; border: 1px solid #ccc;"></div>
                        <span style="font-size: 11px;"><strong>${data.label}</strong> - ${data.desc} (<${data.threshold === Infinity ? '∞' : data.threshold} м/с)</span>
                    </div>
                `;
            }
            html += '</div>';
        } else {
            html += '<div style="display: grid; gap: 4px;">';
            for (const [key, data] of Object.entries(this.nen8100Criteria)) {
                const rgb = data.color;
                html += `
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <div style="width: 20px; height: 14px; background: rgb(${rgb[0]},${rgb[1]},${rgb[2]}); border-radius: 2px; border: 1px solid #ccc;"></div>
                        <span style="font-size: 11px;"><strong>${data.label}</strong> - ${data.desc} (P<${data.maxExceed}%)</span>
                    </div>
                `;
            }
            html += '</div>';
        }
        
        container.innerHTML = html;
    }
    
    /**
     * Скрывает overlay комфорта
     */
    hideComfortOverlay() {
        if (this.comfortOverlay) {
            this.sceneManager.scene.remove(this.comfortOverlay);
            if (this.comfortOverlay.material.map) {
                this.comfortOverlay.material.map.dispose();
            }
            this.comfortOverlay.material.dispose();
            this.comfortOverlay.geometry.dispose();
            this.comfortOverlay = null;
        }
        
        this.comfortSettings.showComfort = false;
        
        const legend = document.getElementById('wcfd-comfort-legend');
        if (legend) legend.classList.add('wcfd-hidden');
        
        const hideBtn = document.getElementById('wcfd-hide-comfort');
        if (hideBtn) hideBtn.classList.add('wcfd-hidden');
    }
    
    /**
     * Экспорт данных комфорта в JSON
     */
    exportComfortData() {
        if (!this.comfortData) {
            alert('Сначала рассчитайте комфорт');
            return;
        }
        
        const exportData = {
            ...this.comfortData,
            epw: {
                location: this.epwData?.location || 'Unknown',
                filename: this.epwData?.filename || 'Unknown'
            },
            settings: this.comfortSettings
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wind_comfort_${this.comfortSettings.standard}_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        console.log('[WindCFD] Comfort data exported');
    }
    
    destroy() {
        this.hideDomain();
        this.hideCurrentOverlay();
        this.hideComfortOverlay();
        this.hideWindArrow();
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
    }
}

export { WindCFD };
window.WindCFD = WindCFD;