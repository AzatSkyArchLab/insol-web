/**
 * ============================================
 * SolarRadiationController.js v4.0
 * UI контроллер Solar Radiation
 * Стиль как у CFD панели
 * ============================================
 */

class SolarRadiationController {
    constructor(app) {
        this.app = app;
        this.solarRadiation = null;
        
        this.panel = null;
        this.isVisible = false;
        
        // Сворачиваемые секции
        this.sectionsState = {
            settings: true,
            mesh: false
        };
        
        // Drag state
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        
        // Сохранённые здания для анализа
        this.selectedBuildings = [];
        
        this.settings = {
            year: 2024,
            startMonth: 1,
            startDay: 1,
            startHour: 6,
            endMonth: 12,
            endDay: 31,
            endHour: 20,
            dayStep: 7,
            targetFaceArea: 4.0,
            groundTargetArea: 16.0,
            groundBuffer: 50,
            colorScale: 'viridis'
        };
        
        console.log('[SolarRadiationController] v4.0');
    }
    
    _ensureSolarRadiation() {
        if (this.solarRadiation) return true;
        
        const sceneManager = this.app.state?.sceneManager;
        if (!sceneManager) return false;
        
        if (window.SolarRadiation) {
            this.solarRadiation = new SolarRadiation(sceneManager, {
                onProgress: (msg, pct) => this._updateProgress(msg, pct)
            });
            return true;
        }
        
        return false;
    }
    
    showPanel() {
        if (this.panel) {
            this.panel.style.display = 'block';
            this.isVisible = true;
            this._updateBuildingCount();
            return;
        }
        this._createPanel();
        this.isVisible = true;
    }
    
    hidePanel() {
        if (this.panel) this.panel.style.display = 'none';
        this.isVisible = false;
    }
    
    togglePanel() {
        this.isVisible ? this.hidePanel() : this.showPanel();
    }
    
    _createPanel() {
        this.panel = document.createElement('div');
        this.panel.id = 'solar-radiation-panel';
        this.panel.className = 'tool-panel';
        this.panel.style.cssText = `
            position: fixed;
            top: 80px;
            left: 20px;
            width: 380px;
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.12);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            z-index: 1000;
            overflow: hidden;
            max-height: calc(100vh - 100px);
            display: flex;
            flex-direction: column;
        `;
        
        this.panel.innerHTML = `
            <!-- Header -->
            <div id="sr-header" style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                border-bottom: 1px solid #eee;
                cursor: move;
            ">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 20px;">☀️</span>
                    <span style="font-weight: 600; font-size: 16px;">Solar Radiation</span>
                </div>
                <button id="sr-close" style="
                    background: none;
                    border: none;
                    font-size: 20px;
                    color: #999;
                    cursor: pointer;
                    padding: 4px;
                    line-height: 1;
                ">×</button>
            </div>
            
            <!-- Content -->
            <div style="padding: 16px 20px; overflow-y: auto; flex: 1;">
                
                <!-- 1. Выбранные здания -->
                <div class="sr-section-header" style="color: #4A6CF7; font-weight: 600; font-size: 12px; margin-bottom: 12px; letter-spacing: 0.5px;">
                    1. ВЫБРАННЫЕ ЗДАНИЯ
                </div>
                <div style="background: #f8f9fa; border-radius: 8px; padding: 14px; margin-bottom: 20px;">
                    <div id="sr-building-info" style="margin-bottom: 12px;">
                        <span id="sr-building-count" style="font-weight: 600;">0</span> зданий
                    </div>
                    <button id="sr-apply-selection" style="
                        width: 100%;
                        padding: 10px;
                        background: #fff;
                        border: 1px solid #ddd;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 14px;
                    ">Применить выбор</button>
                </div>
                
                <!-- 2. Погодные данные -->
                <div class="sr-section-header" style="color: #4A6CF7; font-weight: 600; font-size: 12px; margin-bottom: 12px; letter-spacing: 0.5px;">
                    2. ПОГОДНЫЕ ДАННЫЕ (EPW)
                </div>
                <div style="background: #f8f9fa; border-radius: 8px; padding: 14px; margin-bottom: 20px;">
                    <div id="sr-epw-info" style="margin-bottom: 12px; min-height: 40px;">
                        <div style="color: #888; font-size: 13px;">Файл не загружен</div>
                    </div>
                    <label style="
                        display: block;
                        width: 100%;
                        padding: 10px;
                        background: #fff;
                        border: 1px solid #ddd;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 14px;
                        text-align: center;
                    ">
                        Загрузить EPW
                        <input type="file" id="sr-epw-file" accept=".epw" style="display: none;">
                    </label>
                </div>
                
                <!-- 3. Период анализа -->
                <div class="sr-section-header" style="color: #4A6CF7; font-weight: 600; font-size: 12px; margin-bottom: 12px; letter-spacing: 0.5px;">
                    3. ПЕРИОД АНАЛИЗА
                </div>
                <div style="background: #f8f9fa; border-radius: 8px; padding: 14px; margin-bottom: 20px;">
                    <!-- Начало -->
                    <div style="margin-bottom: 12px;">
                        <div style="font-size: 12px; color: #666; margin-bottom: 6px;">Начало:</div>
                        <div style="display: flex; gap: 8px;">
                            <select id="sr-start-month" style="flex: 2; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; background: #fff;">
                                ${this._getMonthOptions(this.settings.startMonth)}
                            </select>
                            <input type="number" id="sr-start-day" value="${this.settings.startDay}" min="1" max="31" 
                                style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; text-align: center; background: #fff;">
                            <input type="number" id="sr-start-hour" value="${this.settings.startHour}" min="0" max="23"
                                style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; text-align: center; background: #fff;">
                        </div>
                        <div style="display: flex; gap: 8px; font-size: 10px; color: #999; margin-top: 4px;">
                            <span style="flex: 2;">месяц</span>
                            <span style="flex: 1; text-align: center;">день</span>
                            <span style="flex: 1; text-align: center;">час</span>
                        </div>
                    </div>
                    
                    <!-- Конец -->
                    <div>
                        <div style="font-size: 12px; color: #666; margin-bottom: 6px;">Конец:</div>
                        <div style="display: flex; gap: 8px;">
                            <select id="sr-end-month" style="flex: 2; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; background: #fff;">
                                ${this._getMonthOptions(this.settings.endMonth)}
                            </select>
                            <input type="number" id="sr-end-day" value="${this.settings.endDay}" min="1" max="31"
                                style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; text-align: center; background: #fff;">
                            <input type="number" id="sr-end-hour" value="${this.settings.endHour}" min="0" max="23"
                                style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; text-align: center; background: #fff;">
                        </div>
                        <div style="display: flex; gap: 8px; font-size: 10px; color: #999; margin-top: 4px;">
                            <span style="flex: 2;">месяц</span>
                            <span style="flex: 1; text-align: center;">день</span>
                            <span style="flex: 1; text-align: center;">час</span>
                        </div>
                    </div>
                    
                    <!-- Шаг -->
                    <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #e0e0e0;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span style="font-size: 12px; color: #666;">Шаг по дням:</span>
                            <span id="sr-daystep-value" style="font-weight: 600;">${this.settings.dayStep}</span>
                        </div>
                        <input type="range" id="sr-day-step" min="1" max="14" step="1" value="${this.settings.dayStep}"
                            style="width: 100%; accent-color: #4A6CF7;">
                    </div>
                </div>
                
                <!-- 4. Настройки сетки (сворачиваемая) -->
                <div id="sr-mesh-section" style="margin-bottom: 20px;">
                    <div id="sr-mesh-header" style="
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        cursor: pointer;
                        padding: 8px 0;
                    ">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span>⚙️</span>
                            <span style="font-weight: 500;">НАСТРОЙКИ СЕТКИ</span>
                        </div>
                        <span id="sr-mesh-arrow" style="color: #999; transition: transform 0.2s;">▼</span>
                    </div>
                    <div id="sr-mesh-content" style="display: none; background: #f8f9fa; border-radius: 8px; padding: 14px; margin-top: 8px;">
                        <!-- Сетка зданий -->
                        <div style="margin-bottom: 14px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                                <span style="font-size: 12px; color: #666;">Сетка зданий:</span>
                                <span><span id="sr-face-area-value">${this.settings.targetFaceArea}</span> м²</span>
                            </div>
                            <input type="range" id="sr-face-area" min="1" max="20" step="1" value="${this.settings.targetFaceArea}"
                                style="width: 100%; accent-color: #e74c3c;">
                        </div>
                        
                        <!-- Сетка земли -->
                        <div style="margin-bottom: 14px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                                <span style="font-size: 12px; color: #666;">Сетка земли:</span>
                                <span><span id="sr-ground-area-value">${this.settings.groundTargetArea}</span> м²</span>
                            </div>
                            <input type="range" id="sr-ground-area" min="4" max="64" step="4" value="${this.settings.groundTargetArea}"
                                style="width: 100%; accent-color: #27ae60;">
                        </div>
                        
                        <!-- Отступ земли -->
                        <div style="margin-bottom: 14px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                                <span style="font-size: 12px; color: #666;">Отступ земли:</span>
                                <span><span id="sr-buffer-value">${this.settings.groundBuffer}</span> м</span>
                            </div>
                            <input type="range" id="sr-ground-buffer" min="10" max="150" step="10" value="${this.settings.groundBuffer}"
                                style="width: 100%; accent-color: #3498db;">
                        </div>
                        
                        <!-- Цветовая схема -->
                        <div>
                            <div style="font-size: 12px; color: #666; margin-bottom: 6px;">Цветовая схема:</div>
                            <select id="sr-color-scale" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; background: #fff;">
                                <option value="viridis" selected>Viridis</option>
                                <option value="hot">Hot (тёплый)</option>
                                <option value="cool">Cold (холодный)</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <!-- Прогресс -->
                <div id="sr-progress-container" style="display: none; margin-bottom: 16px;">
                    <div id="sr-progress-text" style="font-size: 12px; color: #666; margin-bottom: 6px;"></div>
                    <div style="height: 6px; background: #eee; border-radius: 3px; overflow: hidden;">
                        <div id="sr-progress-bar" style="height: 100%; background: linear-gradient(90deg, #f5af19, #f12711); width: 0%; transition: width 0.15s;"></div>
                    </div>
                </div>
                
                <!-- Результаты -->
                <div id="sr-results" style="display: none; background: #e8f5e9; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
                    <div style="font-weight: 500; margin-bottom: 10px; color: #2e7d32;">📊 Результаты</div>
                    <div id="sr-results-content" style="font-size: 13px;"></div>
                </div>
                
            </div>
            
            <!-- Footer buttons -->
            <div style="padding: 16px 20px; border-top: 1px solid #eee;">
                <button id="sr-analyze" style="
                    width: 100%;
                    padding: 14px;
                    background: linear-gradient(135deg, #f5af19, #f12711);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 600;
                    font-size: 15px;
                    margin-bottom: 10px;
                ">Запустить расчёт</button>
                
                <button id="sr-clear" style="
                    width: 100%;
                    padding: 12px;
                    background: #fff;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                    color: #666;
                ">🗑️ Очистить результаты</button>
            </div>
        `;
        
        document.body.appendChild(this.panel);
        
        this._initDrag();
        this._bindEvents();
        this._updateBuildingCount();
    }
    
    _initDrag() {
        const header = document.getElementById('sr-header');
        
        const onMouseDown = (e) => {
            if (e.target.id === 'sr-close') return;
            this.isDragging = true;
            const rect = this.panel.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            document.body.style.cursor = 'move';
            e.preventDefault();
        };
        
        const onMouseMove = (e) => {
            if (!this.isDragging) return;
            const x = Math.max(0, Math.min(e.clientX - this.dragOffset.x, window.innerWidth - this.panel.offsetWidth));
            const y = Math.max(0, Math.min(e.clientY - this.dragOffset.y, window.innerHeight - this.panel.offsetHeight));
            this.panel.style.left = x + 'px';
            this.panel.style.top = y + 'px';
        };
        
        const onMouseUp = () => {
            this.isDragging = false;
            document.body.style.cursor = '';
        };
        
        header.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
    
    _bindEvents() {
        // Close
        document.getElementById('sr-close').onclick = () => this.hidePanel();
        
        // Apply selection - сохраняем выбранные здания
        document.getElementById('sr-apply-selection').onclick = () => {
            this._applySelection();
        };
        
        // EPW
        document.getElementById('sr-epw-file').onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            if (!this._ensureSolarRadiation()) {
                alert('Загрузите 3D сцену');
                return;
            }
            
            const infoEl = document.getElementById('sr-epw-info');
            infoEl.innerHTML = '<div style="color: #888;">⏳ Загрузка...</div>';
            
            try {
                const data = await this.solarRadiation.loadEPW(file);
                const loc = data.location;
                infoEl.innerHTML = `
                    <div style="font-weight: 600;">${loc.city}</div>
                    <div style="color: #666; font-size: 13px;">${loc.latitude.toFixed(2)}°, ${loc.longitude.toFixed(2)}°</div>
                    <div style="color: #888; font-size: 12px;">${data.hourlyData.length} записей</div>
                `;
            } catch (err) {
                infoEl.innerHTML = `<div style="color: #e74c3c;">✗ ${err.message}</div>`;
                console.error('[SolarRadiationController] EPW error:', err);
            }
        };
        
        // Sliders
        const bindSlider = (id, settingKey, displayId) => {
            const slider = document.getElementById(id);
            const display = document.getElementById(displayId);
            slider.oninput = () => {
                this.settings[settingKey] = parseFloat(slider.value);
                if (display) display.textContent = slider.value;
            };
        };
        
        bindSlider('sr-day-step', 'dayStep', 'sr-daystep-value');
        bindSlider('sr-face-area', 'targetFaceArea', 'sr-face-area-value');
        bindSlider('sr-ground-area', 'groundTargetArea', 'sr-ground-area-value');
        bindSlider('sr-ground-buffer', 'groundBuffer', 'sr-buffer-value');
        
        // Color scale
        document.getElementById('sr-color-scale').onchange = (e) => {
            this.settings.colorScale = e.target.value;
            if (this.solarRadiation) {
                this.solarRadiation.setColorScale(this.settings.colorScale);
            }
        };
        
        // Collapsible mesh section
        document.getElementById('sr-mesh-header').onclick = () => {
            this.sectionsState.mesh = !this.sectionsState.mesh;
            const content = document.getElementById('sr-mesh-content');
            const arrow = document.getElementById('sr-mesh-arrow');
            content.style.display = this.sectionsState.mesh ? 'block' : 'none';
            arrow.style.transform = this.sectionsState.mesh ? 'rotate(180deg)' : '';
        };
        
        // Buttons
        document.getElementById('sr-analyze').onclick = () => this._analyze();
        document.getElementById('sr-clear').onclick = () => {
            if (this.solarRadiation) this.solarRadiation.clearVisualization();
            document.getElementById('sr-results').style.display = 'none';
        };
    }
    
    _applySelection() {
        const selectTool = this.app.state?.selectTool;
        if (!selectTool) {
            alert('Инструмент выбора не доступен');
            return;
        }
        
        // Получаем текущий выбор из SelectTool
        this.selectedBuildings = selectTool.getSelectedBuildings();
        
        if (this.selectedBuildings.length === 0) {
            alert('Сначала выберите здания.\nИспользуйте Shift+Click для множественного выбора.');
            return;
        }
        
        this._updateBuildingCount();
        
        console.log(`[SolarRadiationController] Применено ${this.selectedBuildings.length} зданий`);
    }
    
    _updateBuildingCount() {
        const buildings = this.selectedBuildings;
        const countEl = document.getElementById('sr-building-count');
        const infoEl = document.getElementById('sr-building-info');
        
        if (countEl) {
            countEl.textContent = buildings.length;
        }
        
        if (infoEl && buildings.length > 0) {
            // Найти макс высоту
            let maxHeight = 0;
            for (const mesh of buildings) {
                mesh.geometry.computeBoundingBox();
                const box = mesh.geometry.boundingBox;
                const h = box.max.z - box.min.z;
                if (h > maxHeight) maxHeight = h;
            }
            
            infoEl.innerHTML = `
                <div><span style="font-weight: 600;">${buildings.length}</span> зданий</div>
                <div style="color: #666; font-size: 13px;">Макс. высота: <b>${maxHeight.toFixed(1)} м</b></div>
            `;
        }
    }
    
    _updateProgress(message, percent) {
        const container = document.getElementById('sr-progress-container');
        const text = document.getElementById('sr-progress-text');
        const bar = document.getElementById('sr-progress-bar');
        
        if (container) {
            container.style.display = 'block';
            text.textContent = message;
            bar.style.width = percent + '%';
        }
    }
    
    async _analyze() {
        if (!this._ensureSolarRadiation()) {
            alert('Загрузите 3D сцену');
            return;
        }
        
        // Используем сохранённые здания
        if (this.selectedBuildings.length === 0) {
            alert('Сначала выберите здания и нажмите "Применить выбор".');
            return;
        }
        
        const selected = this.selectedBuildings;
        
        // Собираем настройки из UI
        this.settings.startMonth = parseInt(document.getElementById('sr-start-month').value);
        this.settings.startDay = parseInt(document.getElementById('sr-start-day').value);
        this.settings.startHour = parseInt(document.getElementById('sr-start-hour').value);
        this.settings.endMonth = parseInt(document.getElementById('sr-end-month').value);
        this.settings.endDay = parseInt(document.getElementById('sr-end-day').value);
        this.settings.endHour = parseInt(document.getElementById('sr-end-hour').value);
        
        const btn = document.getElementById('sr-analyze');
        btn.innerHTML = '⏳ Расчёт...';
        btn.disabled = true;
        btn.style.opacity = '0.7';
        document.getElementById('sr-results').style.display = 'none';
        
        try {
            const result = await this.solarRadiation.analyzeBuildings(selected, {
                year: this.settings.year,
                startMonth: this.settings.startMonth,
                startDay: this.settings.startDay,
                startHour: this.settings.startHour,
                endMonth: this.settings.endMonth,
                endDay: this.settings.endDay,
                endHour: this.settings.endHour,
                dayStep: this.settings.dayStep,
                targetFaceArea: this.settings.targetFaceArea,
                groundTargetArea: this.settings.groundTargetArea,
                groundBuffer: this.settings.groundBuffer
            });
            
            if (result) this._showResults(result, selected.length);
            
        } catch (err) {
            console.error('[SolarRadiationController] Ошибка:', err);
            alert('Ошибка: ' + err.message);
        } finally {
            btn.innerHTML = 'Запустить расчёт';
            btn.disabled = false;
            btn.style.opacity = '1';
            document.getElementById('sr-progress-container').style.display = 'none';
        }
    }
    
    _showResults(result, buildingCount) {
        const container = document.getElementById('sr-results');
        const content = document.getElementById('sr-results-content');
        
        if (result.statistics) {
            const s = result.statistics;
            content.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div>Зданий: <b>${buildingCount}</b></div>
                    <div>Солнц: <b>${s.sun_vectors_count}</b></div>
                    <div>Мин: <b>${s.min_hours} ч</b></div>
                    <div>Макс: <b>${s.max_hours} ч</b></div>
                    <div>Среднее: <b>${s.mean_hours?.toFixed(0)} ч</b></div>
                    <div>Время: <b>${s.time_seconds}s</b></div>
                </div>
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(0,0,0,0.1); font-size: 12px; color: #666;">
                    Ground: ${s.ground_faces?.toLocaleString()} • Здания: ${s.building_faces?.toLocaleString()}
                </div>
            `;
            container.style.display = 'block';
        }
    }
    
    _getMonthOptions(selected) {
        const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
        return months.map((name, i) =>
            `<option value="${i + 1}" ${i + 1 === selected ? 'selected' : ''}>${name}</option>`
        ).join('');
    }
    
    dispose() {
        if (this.solarRadiation) this.solarRadiation.dispose();
        if (this.panel) this.panel.remove();
    }
}

export { SolarRadiationController };
window.SolarRadiationController = SolarRadiationController;