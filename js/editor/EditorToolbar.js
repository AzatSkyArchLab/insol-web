/**
 * ============================================
 * EditorToolbar.js
 * Панель инструментов (с MoveTool)
 * ============================================
 */

class EditorToolbar {
    static instanceCount = 0;
    static currentKeyHandler = null;
    
    constructor(options = {}) {
        this.instanceId = ++EditorToolbar.instanceCount;
        this.currentTool = 'select';
        this.drawMode = 'polygon';  // 'polygon' или 'rect'
        
        this.onChange = options.onChange || (() => {});
        
        this._createToolbar();
        
        console.log(`[EditorToolbar #${this.instanceId}] Создан`);
    }
    
    _createToolbar() {
        // Удаляем старый toolbar если существует
        const existingToolbar = document.getElementById('editor-toolbar');
        if (existingToolbar) {
            existingToolbar.remove();
            console.log('[EditorToolbar] Удалён старый toolbar');
        }
        
        this.element = document.createElement('div');
        this.element.id = 'editor-toolbar';
        this.element.className = 'editor-toolbar';
        this.element.innerHTML = `
            <div class="compass-mini" id="compass-mini">
                <div class="compass-mini-ring">
                    <span class="compass-mini-n">С</span>
                </div>
            </div>
            <div class="tool-separator"></div>
            <div class="file-menu">
                <button class="tool-btn file-menu-btn" title="Файл">
                    <span class="tool-icon">📁</span>
                    <span class="tool-label">Файл</span>
                </button>
                <div class="file-menu-dropdown">
                    <!-- TODO: Импорт GeoJSON временно отключён
                    <button class="dropdown-item" data-action="import-geojson">
                        <span>📂</span> Открыть GeoJSON...
                    </button>
                    <div class="dropdown-divider"></div>
                    -->
                    <button class="dropdown-item" data-action="export-geojson">
                        <span>💾</span> Сохранить GeoJSON
                    </button>
                    <button class="dropdown-item" data-action="export-obj">
                        <span>📦</span> Экспорт OBJ
                    </button>
                    <!-- TODO: Вернуть после доработки аналитики
                    <div class="dropdown-divider"></div>
                    <button class="dropdown-item" data-action="solar-potential">
                        <span>☀️</span> Инсоляционный потенциал...
                    </button>
                    <button class="dropdown-item" data-action="tower-generation">
                        <span>🏗</span> Генерация застройки...
                    </button>
                    -->
                </div>
            </div>
            <div class="tool-separator"></div>
            <button class="tool-btn active" data-tool="select" title="Выбор (V)">
                <span class="tool-icon">↖</span>
                <span class="tool-label">Выбор</span>
            </button>
            <button class="tool-btn" data-tool="move" title="Переместить (M)&#10;Поворот: колёсико / R,E&#10;Shift = точно (1°)">
                <span class="tool-icon">✥</span>
                <span class="tool-label">Двигать</span>
            </button>
            <div class="draw-menu">
                <button class="tool-btn draw-menu-btn" title="Рисовать (D)">
                    <span class="tool-icon">✏</span>
                    <span class="tool-label">Рисовать</span>
                    <span class="dropdown-arrow">▾</span>
                </button>
                <div class="draw-menu-dropdown">
                    <button class="dropdown-item" data-draw-mode="polygon">
                        <span>✏</span> Свободный полигон
                    </button>
                    <button class="dropdown-item" data-draw-mode="rect">
                        <span>▭</span> Прямоугольник
                    </button>
                </div>
            </div>
            <!-- TODO: Вернуть после доработки аналитики
            <button class="tool-btn" data-tool="potential" title="Инсоляционный потенциал (P)&#10;Нарисуйте полигон участка">
                <span class="tool-icon">☀</span>
                <span class="tool-label">Потенциал</span>
            </button>
            <button class="tool-btn" data-tool="generate" title="Генерация застройки (G)&#10;Нарисуйте полигон участка">
                <span class="tool-icon">🏗</span>
                <span class="tool-label">Генерация</span>
            </button>
            -->
            <div class="tool-separator"></div>
            <button class="tool-btn danger" data-tool="delete" title="Удалить (Del)">
                <span class="tool-icon">🗑</span>
                <span class="tool-label">Удалить</span>
            </button>
        `;
        
        document.getElementById('scene-mode').appendChild(this.element);
        
        // Обработчики для инструментов
        this.element.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.setTool(btn.dataset.tool);
            });
        });
        
        // Меню файла
        this._initFileMenu();
        
        // Меню рисования
        this._initDrawMenu();
        
        // Блокируем всплытие с самого toolbar
        this.element.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        this.element.addEventListener('mouseup', (e) => {
            e.stopPropagation();
        });
        this.element.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        // Горячие клавиши - удаляем старый handler если есть
        if (EditorToolbar.currentKeyHandler) {
            document.removeEventListener('keydown', EditorToolbar.currentKeyHandler);
        }
        
        // Сохраняем ссылку для возможного удаления
        this._boundKeyHandler = (e) => {
            if (e.repeat) return;
            if (e.target.tagName === 'INPUT') return;
            
            // Используем event.code для независимости от раскладки
            switch(e.code) {
                case 'KeyV': this.setTool('select'); break;
                case 'KeyM': this.setTool('move'); break;
                case 'KeyD': this.setTool('draw'); break;  // Активирует текущий drawMode
                // case 'KeyP': this.setTool('potential'); break;  // TODO: вернуть
                // case 'KeyG': this.setTool('generate'); break;   // TODO: вернуть
                case 'Delete': this.setTool('delete'); break;
                case 'Escape': this.setTool('select'); break;
            }
        };
        EditorToolbar.currentKeyHandler = this._boundKeyHandler;
        document.addEventListener('keydown', this._boundKeyHandler);
    }
    
    _initFileMenu() {
        const fileMenu = this.element.querySelector('.file-menu');
        const menuBtn = fileMenu.querySelector('.file-menu-btn');
        const dropdown = fileMenu.querySelector('.file-menu-dropdown');
        
        // Toggle dropdown
        menuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropdown.classList.toggle('visible');
        });
        
        // Закрыть при клике вне меню
        document.addEventListener('click', (e) => {
            if (!fileMenu.contains(e.target)) {
                dropdown.classList.remove('visible');
            }
        });
        
        // Обработчики пунктов меню
        dropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const action = item.dataset.action;
                dropdown.classList.remove('visible');
                
                switch (action) {
                    // TODO: Импорт GeoJSON временно отключён
                    // case 'import-geojson':
                    //     if (window.importProjectFromGeoJSON) {
                    //         window.importProjectFromGeoJSON();
                    //     }
                    //     break;
                    case 'export-geojson':
                        if (window.exportProjectToGeoJSON) {
                            window.exportProjectToGeoJSON();
                        }
                        break;
                    case 'export-obj':
                        if (window.exportProjectToOBJ) {
                            window.exportProjectToOBJ();
                        }
                        break;
                    case 'solar-potential':
                        if (window.startSolarPotential) {
                            window.startSolarPotential();
                        }
                        break;
                    case 'tower-generation':
                        if (window.startTowerGeneration) {
                            window.startTowerGeneration();
                        }
                        break;
                }
            });
        });
    }
    
    _initDrawMenu() {
        const drawMenu = this.element.querySelector('.draw-menu');
        if (!drawMenu) {
            console.warn('[EditorToolbar] draw-menu не найден');
            return;
        }
        
        const btn = drawMenu.querySelector('.draw-menu-btn');
        const dropdown = drawMenu.querySelector('.draw-menu-dropdown');
        
        console.log('[EditorToolbar] Инициализация draw-menu', { btn, dropdown });
        
        // Клик по кнопке - открыть dropdown
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[EditorToolbar] Клик по draw-menu-btn');
            dropdown.classList.toggle('visible');
        });
        
        // Закрыть при клике вне меню
        document.addEventListener('click', (e) => {
            if (!drawMenu.contains(e.target)) {
                dropdown.classList.remove('visible');
            }
        });
        
        // Обработчики пунктов меню
        dropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const mode = item.dataset.drawMode;
                console.log('[EditorToolbar] Выбран режим:', mode);
                dropdown.classList.remove('visible');
                
                // Сохраняем режим рисования
                this.drawMode = mode;
                
                // Обновляем иконку кнопки
                const icon = btn.querySelector('.tool-icon');
                if (mode === 'rect') {
                    icon.textContent = '▭';
                } else {
                    icon.textContent = '✏';
                }
                
                // Активируем инструмент draw (main.js разберётся по drawMode)
                this.setTool('draw');
            });
        });
    }
    
    getDrawMode() {
        return this.drawMode;
    }
    
    setTool(tool) {
        if (tool === 'delete') {
            this.onChange('delete', this.currentTool);
            return;
        }
        
        // Защита от повторного вызова того же инструмента
        if (tool === this.currentTool) {
            return;
        }
        
        const prevTool = this.currentTool;
        this.currentTool = tool;
        
        this.element.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
        
        this.onChange(tool, prevTool);
        
        console.log(`[EditorToolbar #${this.instanceId}] Инструмент: ${tool}`);
    }
    
    getTool() {
        return this.currentTool;
    }
    
    show() {
        this.element.classList.remove('hidden');
    }
    
    hide() {
        this.element.classList.add('hidden');
    }
}

export { EditorToolbar };
window.EditorToolbar = EditorToolbar;