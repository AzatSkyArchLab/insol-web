/**
 * WindCFD.js
 * CFD ветровой анализ с интеграцией EPW
 * v3.0 - Модульная архитектура
 * 
 * Главный класс, объединяющий все модули
 */

import { 
    DEFAULT_DOMAIN_SETTINGS, 
    DEFAULT_COMFORT_SETTINGS,
    DEFAULT_VISUALIZATION_SETTINGS,
    DEFAULT_FLOW_SETTINGS
} from './WindCFDConstants.js';

import { 
    getOrCreateSessionId, 
    exportToJSON, 
    sleep 
} from './WindCFDUtils.js';

import { 
    injectStyles, 
    injectModalStyles,
    createPanelHTML 
} from './WindCFDUI.js';

import { EPWParser, renderWindRoseButtons, renderEPWInfo } from './WindCFDEPW.js';
import { CFDServerClient, createCFDConfig } from './WindCFDServer.js';
import { CFDVisualization } from './WindCFDVisualization.js';
import { CFDDomain } from './WindCFDDomain.js';
import { WindComfortAnalyzer, renderComfortSection } from './WindCFDComfort.js';

/**
 * Главный класс WindCFD
 */
class WindCFD {
    constructor(sceneManager, coords) {
        this.sceneManager = sceneManager;
        this.coords = coords;
        
        // Session ID для multi-user
        this.sessionId = getOrCreateSessionId();
        
        // Инициализация модулей
        this.domain = new CFDDomain(sceneManager, THREE);
        this.epwParser = new EPWParser();
        this.server = new CFDServerClient('http://localhost:8765', this.sessionId);
        this.visualization = new CFDVisualization(sceneManager, THREE);
        this.comfortAnalyzer = new WindComfortAnalyzer(sceneManager, THREE);
        
        // Состояние
        this.epwData = null;
        this.selectedDirection = null;
        this.selectedSpeed = null;
        this.speedType = 'mean';
        this.isCalculating = false;
        this.currentConfig = null;
        
        // Настройки
        this.domainSettings = { ...DEFAULT_DOMAIN_SETTINGS };
        this.sliceHeight = DEFAULT_VISUALIZATION_SETTINGS.sliceHeight;
        
        // Пакетный расчёт
        this.batchMode = false;
        this.batchQueue = [];
        this.batchTotal = 0;
        this.batchCompleted = 0;
        
        // Хранилище результатов по направлениям
        this.results = {};
        this.activeDirection = null;
        
        // Аниматор потоков (инициализируется позже)
        this.flowAnimator = null;
        
        // UI
        this.panel = null;
        this.createPanel();
        
        // Загружаем существующие результаты с сервера
        this.loadCachedDirections();
        
        console.log('[WindCFD] Инициализирован v3.0 (modular), session:', this.sessionId.substring(0, 8));
    }
    
    // ==================== UI ====================
    
    createPanel() {
        const existing = document.getElementById('wind-cfd-panel');
        if (existing) existing.remove();
        
        this.panel = document.createElement('div');
        this.panel.id = 'wind-cfd-panel';
        this.panel.className = 'wind-cfd-panel hidden';
        this.panel.innerHTML = createPanelHTML();
        
        document.body.appendChild(this.panel);
        injectStyles();
        this.bindEvents();
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
    }
    
    show() {
        this.panel.classList.remove('hidden');
        this.updateBuildingsInfo();
        this.loadCachedDirections();
    }
    
    hide() {
        this.panel.classList.add('hidden');
        this.domain.hideDomain();
        this.visualization.hideWindArrow();
    }
    
    // ==================== Настройки ====================
    
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
    
    applyCFDSettings() {
        this.domainSettings = {
            inletFactor: parseFloat(document.getElementById('wcfd-inlet-factor').value) || 5,
            outletFactor: parseFloat(document.getElementById('wcfd-outlet-factor').value) || 8,
            lateralFactor: parseFloat(document.getElementById('wcfd-lateral-factor').value) || 2.5,
            heightFactor: parseFloat(document.getElementById('wcfd-height-factor').value) || 5,
            cellSize: parseFloat(document.getElementById('wcfd-cell-size').value) || 5,
            maxCells: parseFloat(document.getElementById('wcfd-max-cells').value) || 3,
            refinementMin: parseInt(document.getElementById('wcfd-refine-min').value) || 1,
            refinementMax: parseInt(document.getElementById('wcfd-refine-max').value) || 2,
            iterations: parseInt(document.getElementById('wcfd-iterations').value) || 400
        };
        
        // Синхронизируем настройки с domain
        this.domain.setDomainSettings(this.domainSettings);
        
        // Пересчитываем домен если есть здания
        if (this.domain.getBuildings().length > 0) {
            this.domain.updateDomain(this.domainSettings);
            this.updateDomainInfo();
        }
        
        console.log('[WindCFD] Настройки CFD применены:', this.domainSettings);
        
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
    
    // ==================== Выбор зданий ====================
    
    startBuildingSelection() {
        // Очищаем предыдущий выбор
        if (window.selectTool) {
            window.selectTool.clearCFDTreeSelection?.();
            window.selectTool.clearMultiSelection?.();
        }
        
        // Включаем CFD режим для выбора деревьев
        if (window.selectTool?.setCFDMode) {
            window.selectTool.setCFDMode(true);
        }
        
        alert('Выберите здания (Shift+клик) и деревья для CFD расчёта.\n\n' +
              '• Здания: Shift+клик для множественного выбора (фиолетовый)\n' +
              '• Деревья: клик для добавления в CFD (оранжевый)\n\n' +
              'Затем нажмите "Применить выбор"');
        
        const btn = document.getElementById('wcfd-select-buildings');
        btn.textContent = 'Применить выбор';
        btn.onclick = () => this.applyBuildingSelection();
    }
    
    applyBuildingSelection() {
        if (window.selectTool) {
            // Получаем выбранные здания (обычный мультиселект)
            const selectedBuildings = window.selectTool.getSelectedBuildings?.() || 
                                      window.selectTool.getSelectedMultiple?.() || [];
            
            // Получаем деревья для CFD (отдельный список с оранжевой подсветкой)
            const cfdTrees = window.selectTool.getCFDSelectedTrees?.() || [];
            
            // Fallback на обычный getSelectedTrees если CFD метод не доступен
            const selectedTrees = cfdTrees.length > 0 ? cfdTrees : 
                                  (window.selectTool.getSelectedTrees?.() || []);
            
            if (selectedBuildings.length > 0) {
                // Устанавливаем здания
                this.domain.setBuildings(selectedBuildings);
                
                // Устанавливаем деревья (только явно выбранные для CFD!)
                this.domain.setTrees(selectedTrees);
                
                if (selectedTrees.length > 0) {
                    console.log(`[WindCFD] Выбрано деревьев для CFD: ${selectedTrees.length}`);
                } else {
                    console.log('[WindCFD] Деревья не выбраны для CFD');
                }
                
                this.updateBuildingsInfo();
                this.updateDomainInfo();
            } else {
                alert('Выберите хотя бы одно здание (деревья опционально)');
            }
        }
        
        // Выключаем CFD режим
        if (window.selectTool?.setCFDMode) {
            window.selectTool.setCFDMode(false);
        }
        
        const btn = document.getElementById('wcfd-select-buildings');
        btn.textContent = 'Выбрать объекты';
        btn.onclick = () => this.startBuildingSelection();
    }
    
    updateBuildingsInfo() {
        const info = document.getElementById('wcfd-buildings-info');
        const buildingsInfo = this.domain.getBuildingsInfo();
        const treesInfo = this.domain.getTreesInfo();
        
        let html = '';
        
        if (buildingsInfo.count === 0 && treesInfo.count === 0) {
            info.textContent = 'Не выбрано';
        } else {
            if (buildingsInfo.count > 0) {
                html += `<strong>${buildingsInfo.count}</strong> зданий<br>`;
                html += `Макс. высота: <strong>${buildingsInfo.maxHeight.toFixed(1)} м</strong>`;
            }
            
            if (treesInfo.count > 0) {
                if (buildingsInfo.count > 0) html += '<br>';
                html += `🌳 <strong>${treesInfo.count}</strong> деревьев`;
                
                // Показываем типы деревьев с понятными названиями
                const typeNames = {
                    'dense': 'густых',
                    'medium': 'средних', 
                    'sparse': 'редких'
                };
                const types = Object.entries(treesInfo.types);
                if (types.length > 0) {
                    const typeStr = types.map(([t, c]) => `${c} ${typeNames[t] || t}`).join(', ');
                    html += `<br><span style="font-size:11px;color:#888;">(${typeStr})</span>`;
                }
                
                // Кнопка очистки деревьев
                html += `<br><button id="wcfd-clear-trees" style="font-size:10px;padding:2px 6px;margin-top:4px;">Убрать деревья</button>`;
            }
            
            info.innerHTML = html;
            
            // Обработчик кнопки очистки деревьев
            const clearBtn = document.getElementById('wcfd-clear-trees');
            if (clearBtn) {
                clearBtn.onclick = () => {
                    // Очищаем CFD выбор в SelectTool
                    if (window.selectTool?.clearCFDTreeSelection) {
                        window.selectTool.clearCFDTreeSelection();
                    }
                    // Fallback на старый метод
                    if (window.selectTool?.clearTreeSelection) {
                        window.selectTool.clearTreeSelection();
                    }
                    // Очищаем в domain
                    this.domain.clearTrees?.();
                    this.domain.setTrees([]);
                    this.updateBuildingsInfo();
                    this.updateDomainInfo();
                };
            }
        }
        this.updateCalculateButtons();
    }
    
    updateDomainInfo() {
        const domainInfo = this.domain.getDomainInfo(this.domainSettings);
        const info = document.getElementById('wcfd-domain-info');
        
        if (typeof domainInfo === 'string') {
            info.textContent = domainInfo;
        } else {
            info.innerHTML = `
                <strong>${domainInfo.dimensions}</strong><br>
                H = ${domainInfo.maxHeight}м | Зданий: ${domainInfo.buildingsSize}м<br>
                <span style="font-size: 11px; color: #888;">
                    Сервер: ${domainInfo.serverParams}
                </span>
            `;
        }
    }
    
    toggleDomain(visible) {
        this.domain.toggleDomain(visible);
        if (visible && this.selectedDirection !== null) {
            this.updateWindArrow();
        } else if (!visible) {
            this.visualization.hideWindArrow();
        }
    }
    
    // ==================== EPW ====================
    
    async loadEPW() {
        try {
            this.epwData = await this.epwParser.loadFromFile();
            this.updateEPWInfo();
            this.renderWindRose();
            this.updateCalculateButtons();
        } catch (err) {
            alert(err.message);
        }
    }
    
    updateEPWInfo() {
        const info = document.getElementById('wcfd-epw-info');
        info.innerHTML = renderEPWInfo(this.epwData);
        
        if (this.epwData) {
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
                    this.updateSpeedForCurrentDirection();
                }
                this.updateWindArrow();
                this.updateSelectedWindInfo();
            };
            
            customInput.onchange = () => {
                const val = parseFloat(customInput.value);
                if (!isNaN(val) && val > 0) {
                    this.selectedSpeed = val;
                    this.speedType = 'custom';
                    this.updateWindArrow();
                    this.updateSelectedWindInfo();
                }
            };
        }
    }
    
    updateSpeedForCurrentDirection() {
        if (!this.epwData || this.speedType === 'custom') return;
        this.selectedSpeed = this.epwParser.getSpeedForDirection(this.selectedDirection, this.speedType);
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
    
    renderWindRose() {
        const container = document.getElementById('wcfd-wind-rose');
        container.innerHTML = '';
        
        if (!this.epwData?.sectors) return;
        
        document.getElementById('wcfd-direction-section').classList.remove('wcfd-hidden');
        
        this.epwData.sectors.forEach((sector, i) => {
            const btn = document.createElement('button');
            btn.className = 'wcfd-wind-btn';
            btn.dataset.angle = sector.angle;
            
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
        this.updateSpeedForCurrentDirection();
        
        document.getElementById('wcfd-selected-wind').innerHTML = `
            Направление: <strong>${sector.name} (${sector.angle}°)</strong><br>
            Скорость: <strong>${this.selectedSpeed.toFixed(1)} м/с</strong>
        `;
        
        this.updateWindArrow();
        this.updateCalculateButtons();
        
        const result = this.results[sector.angle];
        
        if (result) {
            if (!result.data) {
                console.log(`[WindCFD] Загрузка данных для ${sector.angle}°...`);
                const data = await this.server.loadDirectionData(sector.angle);
                if (data) {
                    this.results[sector.angle] = {
                        data: data,
                        speed: sector.meanSpeed,
                        case_dir: data.case_dir,
                        case_name: data.case_name
                    };
                }
            }
            
            if (this.results[sector.angle]?.data) {
                this.showDirectionResult(sector.angle);
            }
        }
    }
    
    updateWindArrow() {
        this.visualization.renderWindArrow(
            this.domain.domainParams,
            this.selectedDirection,
            this.selectedSpeed
        );
    }
    
    updateCalculateButtons() {
        const btn = document.getElementById('wcfd-calculate');
        const btnAll = document.getElementById('wcfd-calculate-all');
        
        // Можно считать если есть хотя бы здания или деревья
        const hasObjects = this.domain.getBuildings().length > 0 || 
                          this.domain.getTrees().length > 0;
        
        const canCalculate = hasObjects && 
                            this.selectedDirection !== null &&
                            this.selectedSpeed !== null;
        
        const canCalculateAll = hasObjects && this.epwData?.sectors;
        
        if (this.results[this.selectedDirection]) {
            btn.textContent = 'Пересчитать';
        } else {
            btn.textContent = 'Запустить расчёт';
        }
        
        btn.disabled = !canCalculate || this.isCalculating;
        btnAll.disabled = !canCalculateAll || this.isCalculating;
        
        if (canCalculateAll) {
            const pending = this.epwData.sectors.filter(
                s => !this.results[s.angle] || this.results[s.angle].cached
            ).length;
            btnAll.textContent = `🔄 Рассчитать все направления (${pending} из 8)`;
            if (pending === 0) btnAll.disabled = true;
        }
    }
    
    // ==================== Кеш ====================
    
    async loadCachedDirections() {
        const directions = await this.server.loadCachedDirections();
        
        console.log('[WindCFD] Найдено кешированных направлений:', Object.keys(directions));
        
        for (const [angle, info] of Object.entries(directions)) {
            const angleNum = parseInt(angle);
            if (!this.results[angleNum]) {
                this.results[angleNum] = {
                    data: null,
                    case_dir: info.case_dir,
                    case_name: info.case_name,
                    cached: true
                };
            }
        }
        
        this.renderWindRose();
    }
    
    // ==================== Расчёт ====================
    
    async startCalculation() {
        if (this.isCalculating) return;
        this.isCalculating = true;
        
        const progress = document.getElementById('wcfd-progress');
        const progressText = document.getElementById('wcfd-progress-text');
        const calcBtn = document.getElementById('wcfd-calculate');
        
        progress.classList.remove('hidden');
        calcBtn.disabled = true;
        
        try {
            progressText.textContent = 'Подготовка геометрии...';
            const geojson = this.domain.exportToGeoJSON();
            
            progressText.textContent = 'Генерация CFD кейса...';
            await sleep(300);
            
            const cfdConfig = createCFDConfig(
                geojson,
                this.domain.domainParams,
                this.selectedDirection,
                this.selectedSpeed,
                this.domainSettings,
                this.sliceHeight
            );
            
            this.currentConfig = cfdConfig;
            this.showCalcProgress(this.selectedDirection);
            
            await this.server.startCalculation(cfdConfig);
            
            this.server.pollStatus(
                (status) => this.updateCalcProgress(status),
                (result) => this.onCalculationComplete(result),
                (error) => this.onCalculationError(error)
            );
            
        } catch (err) {
            alert('Ошибка: ' + err.message);
            console.error(err);
            this.isCalculating = false;
            progress.classList.add('hidden');
            calcBtn.disabled = false;
        }
    }
    
    onCalculationComplete(result) {
        this.saveDirectionResult(this.selectedDirection, result);
        
        this.isCalculating = false;
        this.forceHideCalcProgress();
        
        const progressEl = document.getElementById('wcfd-progress');
        if (progressEl) progressEl.classList.add('hidden');
        const calcBtn = document.getElementById('wcfd-calculate');
        if (calcBtn) calcBtn.disabled = false;
        this.updateCalculateButtons();
        
        // Проверяем сходимость и показываем предупреждение
        if (result.warning || (result.convergence && !result.convergence.converged)) {
            const msg = result.warning || 'Расчёт может быть неточным. Рекомендуется увеличить итерации.';
            console.warn('[WindCFD] ' + msg);
            
            // Показываем предупреждение в UI
            const infoEl = document.getElementById('wcfd-calc-progress-info');
            if (infoEl) {
                infoEl.innerHTML = `<span style="color: #f90;">⚠️ ${msg}</span>`;
                // Скрываем через 10 секунд
                setTimeout(() => {
                    const section = document.getElementById('wcfd-calc-progress-section');
                    if (section) section.classList.add('wcfd-hidden');
                }, 10000);
            }
        }
    }
    
    onCalculationError(error) {
        this.updateCalcProgress({ message: 'Ошибка: ' + error.message, progress: 0 });
        this.isCalculating = false;
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
    
    forceHideCalcProgress() {
        const section = document.getElementById('wcfd-calc-progress-section');
        if (section) section.classList.add('wcfd-hidden');
    }
    
    async stopCalculation() {
        await this.server.stopCalculation();
        this.server.stopPolling();
        this.updateCalcProgress({ message: 'Остановлен', progress: 0 });
        this.isCalculating = false;
        
        setTimeout(() => this.forceHideCalcProgress(), 2000);
        
        const progressEl = document.getElementById('wcfd-progress');
        if (progressEl) progressEl.classList.add('hidden');
        const calcBtn = document.getElementById('wcfd-calculate');
        if (calcBtn) calcBtn.disabled = false;
        this.updateCalculateButtons();
    }
    
    // ==================== Пакетный расчёт ====================
    
    async calculateAllDirections() {
        if (this.isCalculating) {
            alert('Расчёт уже выполняется');
            return;
        }
        
        if (!this.epwData?.sectors || this.domain.getBuildings().length === 0) {
            alert('Сначала выберите здания и загрузите EPW файл');
            return;
        }
        
        const pendingDirections = this.epwData.sectors.filter(
            s => !this.results[s.angle] || this.results[s.angle].cached
        );
        
        if (pendingDirections.length === 0) {
            alert('Все направления уже рассчитаны');
            return;
        }
        
        const confirmMsg = `Запустить расчёт для ${pendingDirections.length} направлений?\n\n` +
            pendingDirections.map(s => `${s.name} (${s.angle}°) - ${s.meanSpeed.toFixed(1)} м/с`).join('\n') +
            `\n\nПримерное время: ${pendingDirections.length * 2}-${pendingDirections.length * 3} минут`;
        
        if (!confirm(confirmMsg)) return;
        
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
        this.updateSpeedForCurrentDirection();
        
        document.querySelectorAll('.wcfd-wind-btn').forEach(btn => {
            btn.classList.remove('active');
            if (parseInt(btn.dataset.angle) === sector.angle) {
                btn.classList.add('active');
            }
        });
        
        this.updateBatchProgress(sector, 'Подготовка...');
        
        try {
            const geojson = this.domain.exportToGeoJSON();
            const cfdConfig = createCFDConfig(
                geojson,
                this.domain.domainParams,
                sector.angle,
                this.selectedSpeed,
                this.domainSettings,
                this.sliceHeight
            );
            
            this.isCalculating = true;
            
            await this.server.startCalculation(cfdConfig);
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
                    const status = await this.server.getStatus();
                    
                    this.updateBatchProgress(sector, status.message || 'Расчёт...');
                    
                    const barEl = document.getElementById('wcfd-batch-bar');
                    if (barEl) {
                        const baseProgress = (this.batchCompleted / this.batchTotal) * 100;
                        const currentProgress = (status.progress / 100) * (100 / this.batchTotal);
                        barEl.style.width = `${baseProgress + currentProgress}%`;
                    }
                    
                    if (status.status === 'completed') {
                        const result = await this.server.getResult();
                        
                        this.results[sector.angle] = { 
                            data: result, 
                            speed: sector.meanSpeed,
                            case_dir: result.case_dir,
                            case_name: result.case_name
                        };
                        this.batchCompleted++;
                        this.isCalculating = false;
                        
                        this.renderWindRose();
                        this.updateBatchProgress(sector, '✅ Готово');
                        
                        console.log(`[WindCFD] ✅ ${sector.name} (${this.batchCompleted}/${this.batchTotal})`);
                        
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
        this.server.stopCalculation().catch(() => {});
        this.updateResultsSection();
        this.updateCalculateButtons();
        console.log('[WindCFD] Пакетный расчёт остановлен');
    }
    
    finishBatchCalculation() {
        this.batchMode = false;
        this.isCalculating = false;
        
        const completed = Object.values(this.results).filter(r => r && !r.cached).length;
        console.log(`[WindCFD] ✅ Пакетный расчёт завершён: ${completed}/8`);
        
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
    
    // ==================== Результаты ====================
    
    saveDirectionResult(angle, data) {
        console.log(`[WindCFD] Сохраняем результат для направления ${angle}°`);
        
        this.hideCurrentOverlay();
        
        this.results[angle] = {
            data: data,
            speed: this.selectedSpeed,
            case_dir: data.case_dir,
            case_name: data.case_name
        };
        
        this.renderWindRose();
        this.showDirectionResult(angle);
        this.updateResultsSection();
    }
    
    showDirectionResult(angle) {
        console.log(`[WindCFD] Показываем результат для направления ${angle}°`);
        
        this.hideCurrentOverlay();
        
        const result = this.results[angle];
        if (!result || !result.data) {
            console.warn(`[WindCFD] Нет результата для направления ${angle}°`);
            return;
        }
        
        this.selectedDirection = angle;
        this.selectedSpeed = result.data.wind_speed || result.speed || 4.0;
        this.activeDirection = angle;
        
        this.visualization.sliceHeight = this.sliceHeight;
        this.visualization.renderResults(result.data, angle);
        this.visualization.updateHeightLabel();
        
        this.updateResultsSection();
        this.updateWindArrow();
    }
    
    hideCurrentOverlay() {
        this.visualization.hideAll();
        this.stopFlowAnimationIfRunning();
        this.activeDirection = null;
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
        
        const displayMode = this.visualization.displayMode;
        const vectorDensity = this.visualization.vectorDensity;
        const vectorScale = this.visualization.vectorScale;
        
        section.innerHTML = `
            <div class="wcfd-label">Результаты</div>
            <div class="wcfd-results-count">
                Рассчитано: <strong>${count}/8</strong>
                ${this.activeDirection !== null ? ` | Показано: <strong>${this.activeDirection}°</strong>` : ''}
            </div>
            
            <div class="wcfd-label" style="margin-top: 8px;">Режим отображения:</div>
            <div class="wcfd-mode-buttons">
                <button class="wcfd-mode-btn ${displayMode === 'gradient' ? 'active' : ''}" data-mode="gradient">🎨 Градиент</button>
                <button class="wcfd-mode-btn ${displayMode === 'vectors' ? 'active' : ''}" data-mode="vectors">➡️ Векторы</button>
                <button class="wcfd-mode-btn ${displayMode === 'both' ? 'active' : ''}" data-mode="both">🎨➡️ Оба</button>
            </div>
            <div class="wcfd-vector-settings ${displayMode === 'gradient' ? 'wcfd-hidden' : ''}" id="wcfd-vector-settings">
                <div class="wcfd-slice-header">
                    <span>Плотность:</span>
                    <span class="wcfd-slice-value" id="wcfd-density-value">${vectorDensity}</span>
                </div>
                <input type="range" id="wcfd-density-slider" min="10" max="200" step="5" value="${vectorDensity}">
                <div class="wcfd-slice-header">
                    <span>Масштаб:</span>
                    <span class="wcfd-slice-value" id="wcfd-scale-value">${vectorScale}x</span>
                </div>
                <input type="range" id="wcfd-scale-slider" min="1" max="10" step="0.5" value="${vectorScale}">
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
            
            ${renderComfortSection(count, this.comfortAnalyzer.settings)}
            
            <button class="wcfd-btn" id="wcfd-hide-results" style="margin-top: 10px;">Скрыть результаты</button>
            <button class="wcfd-btn" id="wcfd-export-results">Экспорт JSON</button>
            <button class="wcfd-btn" id="wcfd-download-paraview">📦 Paraview (${this.activeDirection !== null ? this.activeDirection + '°' : '—'})</button>
            <button class="wcfd-btn wcfd-btn-danger" id="wcfd-clear-all">Очистить все расчёты</button>
        `;
        
        this.visualization.renderLegend(document.getElementById('wcfd-legend'));
        this.bindResultsEvents();
    }
    
    bindResultsEvents() {
        document.getElementById('wcfd-hide-results').onclick = () => this.hideCurrentOverlay();
        document.getElementById('wcfd-export-results').onclick = () => this.exportResults();
        document.getElementById('wcfd-download-paraview').onclick = () => this.downloadParaview();
        document.getElementById('wcfd-clear-all').onclick = () => this.clearAllResults();
        document.getElementById('wcfd-slice-slider').oninput = (e) => this.onSliceHeightChange(e.target.value);
        document.getElementById('wcfd-resample').onclick = () => this.resampleSlice();
        
        // Режим отображения
        document.querySelectorAll('.wcfd-mode-btn').forEach(btn => {
            btn.onclick = () => this.setDisplayMode(btn.dataset.mode);
        });
        
        // Настройки векторов
        const densitySlider = document.getElementById('wcfd-density-slider');
        const scaleSlider = document.getElementById('wcfd-scale-slider');
        
        if (densitySlider) {
            densitySlider.oninput = (e) => {
                this.visualization.vectorDensity = parseInt(e.target.value);
                document.getElementById('wcfd-density-value').textContent = this.visualization.vectorDensity;
                if (this.activeDirection !== null && this.results[this.activeDirection]?.data) {
                    this.visualization.updateVectorField(this.results[this.activeDirection].data, this.activeDirection);
                }
            };
        }
        
        if (scaleSlider) {
            scaleSlider.oninput = (e) => {
                this.visualization.vectorScale = parseFloat(e.target.value);
                document.getElementById('wcfd-scale-value').textContent = `${this.visualization.vectorScale}x`;
                if (this.activeDirection !== null && this.results[this.activeDirection]?.data) {
                    this.visualization.updateVectorField(this.results[this.activeDirection].data, this.activeDirection);
                }
            };
        }
        
        // Comfort events
        const comfortStandard = document.getElementById('wcfd-comfort-standard');
        const comfortSpeedSource = document.getElementById('wcfd-comfort-speed-source');
        const calcComfortBtn = document.getElementById('wcfd-calc-comfort');
        const hideComfortBtn = document.getElementById('wcfd-hide-comfort');
        const exportComfortBtn = document.getElementById('wcfd-export-comfort');
        
        if (comfortStandard) {
            comfortStandard.onchange = (e) => {
                this.comfortAnalyzer.setSettings({ standard: e.target.value });
                this.updateComfortInfo();
            };
        }
        
        if (comfortSpeedSource) {
            comfortSpeedSource.onchange = (e) => {
                this.comfortAnalyzer.setSettings({ speedSource: e.target.value });
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
    
    setDisplayMode(mode) {
        this.visualization.setDisplayMode(mode);
        
        document.querySelectorAll('.wcfd-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        
        const vectorSettings = document.getElementById('wcfd-vector-settings');
        if (vectorSettings) {
            vectorSettings.classList.toggle('wcfd-hidden', mode === 'gradient');
        }
        
        if (this.activeDirection !== null && this.results[this.activeDirection]?.data) {
            this.visualization.hideAll();
            this.visualization.renderResults(this.results[this.activeDirection].data, this.activeDirection);
        }
    }
    
    onSliceHeightChange(value) {
        this.sliceHeight = parseFloat(value);
        const sliceValueEl = document.getElementById('wcfd-slice-value');
        if (sliceValueEl) {
            sliceValueEl.textContent = `${this.sliceHeight.toFixed(2)} м`;
        }
        this.visualization.setSliceHeight(this.sliceHeight);
        this.visualization.updateHeightLabel();
    }
    
    async resampleSlice() {
        const resampleBtn = document.getElementById('wcfd-resample');
        if (!resampleBtn) return;
        
        if (this.activeDirection === null) {
            alert('Сначала выберите направление');
            return;
        }
        
        resampleBtn.disabled = true;
        resampleBtn.textContent = '⏳ Пересчёт...';
        
        try {
            const result = await this.server.resampleSlice(this.sliceHeight, this.activeDirection);
            
            if (this.activeDirection !== null && this.results[this.activeDirection]) {
                this.results[this.activeDirection].data = result;
            }
            
            const directionToShow = this.activeDirection;
            this.hideCurrentOverlay();
            this.activeDirection = directionToShow;
            this.visualization.renderResults(result, directionToShow);
            
            resampleBtn.textContent = '✅ Готово!';
            setTimeout(() => {
                resampleBtn.disabled = false;
                resampleBtn.textContent = '🔄 Пересчитать срез';
            }, 1500);
            
        } catch (error) {
            console.error('[WindCFD] Resample error:', error);
            resampleBtn.textContent = '❌ Ошибка';
            setTimeout(() => {
                resampleBtn.disabled = false;
                resampleBtn.textContent = '🔄 Пересчитать срез';
            }, 2000);
            alert(`Ошибка пересчёта: ${error.message}`);
        }
    }
    
    // ==================== Анимация потоков ====================
    
    toggleFlowAnimation() {
        const btn = document.getElementById('wcfd-toggle-flow');
        
        if (this.activeDirection === null || !this.results[this.activeDirection]) {
            alert('Сначала выполните расчёт и выберите направление для просмотра');
            return;
        }
        
        const data = this.results[this.activeDirection].data;
        
        if (!this.flowAnimator) {
            if (typeof WindFlowAnimation === 'undefined') {
                alert('Модуль WindFlowAnimation.js не загружен.');
                return;
            }
            this.flowAnimator = new WindFlowAnimation(this.sceneManager, this);
        }
        
        if (this.flowAnimator.running) {
            this.flowAnimator.stop();
            btn.textContent = '▶️ Запустить анимацию';
            btn.classList.remove('wcfd-btn-danger');
            btn.classList.add('wcfd-btn-primary');
        } else {
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
    
    // ==================== Комфорт ====================
    
    updateComfortInfo() {
        const info = document.getElementById('wcfd-comfort-info');
        if (!info) return;
        
        const count = Object.values(this.results).filter(r => r && !r.cached).length;
        const settings = this.comfortAnalyzer.settings;
        
        let speedDesc = '';
        switch (settings.speedSource) {
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
        
        if (settings.standard === 'lawson') {
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
    
    calculateWindComfort() {
        const btn = document.getElementById('wcfd-calc-comfort');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Расчёт...';
        }
        
        try {
            this.hideCurrentOverlay();
            
            this.comfortAnalyzer.calculate(this.results, this.epwData, this.sliceHeight);
            this.comfortAnalyzer.renderOverlay(this.sliceHeight);
            
            const legendContainer = document.getElementById('wcfd-comfort-legend');
            if (legendContainer) {
                legendContainer.classList.remove('wcfd-hidden');
                legendContainer.innerHTML = this.comfortAnalyzer.renderLegend();
            }
            
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
            
        } catch (error) {
            console.error('[WindCFD] Comfort calculation error:', error);
            alert('Ошибка расчёта: ' + error.message);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '📊 Рассчитать комфорт';
            }
        }
    }
    
    hideComfortOverlay() {
        this.comfortAnalyzer.hideOverlay();
        
        const legend = document.getElementById('wcfd-comfort-legend');
        if (legend) legend.classList.add('wcfd-hidden');
        
        const hideBtn = document.getElementById('wcfd-hide-comfort');
        if (hideBtn) hideBtn.classList.add('wcfd-hidden');
    }
    
    exportComfortData() {
        try {
            const data = this.comfortAnalyzer.exportData(this.epwData);
            exportToJSON(data, `wind_comfort_${this.comfortAnalyzer.settings.standard}_${new Date().toISOString().slice(0,10)}.json`);
        } catch (error) {
            alert(error.message);
        }
    }
    
    // ==================== Paraview ====================
    
    async downloadParaview() {
        const direction = this.activeDirection ?? this.selectedDirection;
        if (direction === null) {
            alert('Сначала выберите направление и дождитесь завершения расчёта');
            return;
        }
        
        if (!this.results[direction]) {
            alert(`Нет результата для направления ${direction}°. Сначала выполните расчёт.`);
            return;
        }
        
        try {
            const info = await this.server.getParaviewInfo(direction);
            this.showParaviewModal(info);
        } catch (error) {
            console.error('[WindCFD] Paraview error:', error);
            alert('Ошибка: ' + error.message);
        }
    }
    
    showParaviewModal(info) {
        const existing = document.getElementById('wcfd-paraview-modal');
        if (existing) existing.remove();
        
        injectModalStyles();
        
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
                const blob = await this.server.downloadParaview(info.wind_direction);
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
    
    // ==================== Очистка ====================
    
    async clearServerCache() {
        if (!confirm('Удалить все расчёты CFD на сервере?')) return;
        
        try {
            const data = await this.server.cleanup();
            console.log('[WindCFD] Сервер очищен:', data);
            
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
        
        this.hideCurrentOverlay();
        this.results = {};
        
        this.renderWindRose();
        document.getElementById('wcfd-results-section').classList.add('wcfd-hidden');
        this.updateCalculateButtons();
        
        try {
            await this.server.cleanup();
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
        
        exportToJSON(result.data, `wind_${this.activeDirection}deg.json`);
    }
    
    loadResults(jsonData) {
        const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
        
        if (!data.grid || !data.grid.values) {
            throw new Error('Неверный формат данных');
        }
        
        const angle = data.wind_direction ?? this.selectedDirection ?? 0;
        this.saveDirectionResult(angle, data);
    }
    
    destroy() {
        this.domain.destroy();
        this.visualization.destroy();
        this.comfortAnalyzer.destroy();
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
    }
}

export { WindCFD };
window.WindCFD = WindCFD;