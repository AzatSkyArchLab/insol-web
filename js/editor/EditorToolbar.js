/**
 * ============================================
 * EditorToolbar.js
 * Панель инструментов
 * ============================================
 */

class EditorToolbar {
    static instanceCount = 0;
    static currentKeyHandler = null;

    constructor(options = {}) {
        this.instanceId = ++EditorToolbar.instanceCount;
        this.currentTool = 'select';
        this.drawMode = 'polygon';

        this.onChange = options.onChange || (() => {});

        this._createToolbar();

        console.log(`[EditorToolbar #${this.instanceId}] Создан`);
    }

    _createToolbar() {
        const existingToolbar = document.getElementById('editor-toolbar');
        if (existingToolbar) {
            existingToolbar.remove();
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
                    <button class="dropdown-item" data-action="export-geojson">
                        <span>💾</span> Сохранить GeoJSON
                    </button>
                    <button class="dropdown-item" data-action="export-obj">
                        <span>📦</span> Экспорт OBJ
                    </button>
                    <div class="dropdown-divider"></div>
                    <button class="dropdown-item" data-action="cfd-analysis">
                        <span>🌀</span> CFD Анализ
                    </button>
                    <button class="dropdown-item" data-action="solar-radiation-menu">
                        <span>☀️</span> Солнечная радиация
                    </button>
                </div>
            </div>
            <div class="tool-separator"></div>
            <button class="tool-btn active" data-tool="select" title="Выбор (V)">
                <span class="tool-icon">↖</span>
                <span class="tool-label">Выбор</span>
            </button>
            <button class="tool-btn" data-tool="move" title="Переместить (M)">
                <span class="tool-icon">✥</span>
                <span class="tool-label">Двигать</span>
            </button>
            <button class="tool-btn" data-tool="measure" title="Линейка (R)">
                <span class="tool-icon">📏</span>
                <span class="tool-label">Линейка</span>
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
            <button class="tool-btn" data-tool="potential" title="Инсоляционная горка (P)">
                <span class="tool-icon">⛰️</span>
                <span class="tool-label">Горка</span>
            </button>
            <button class="tool-btn" data-tool="tree" title="Дерево (T)">
                <span class="tool-icon">🌳</span>
                <span class="tool-label">Дерево</span>
            </button>
            <div class="tool-separator"></div>
            <button class="tool-btn danger" data-tool="delete" title="Удалить (Del)">
                <span class="tool-icon">🗑</span>
                <span class="tool-label">Удалить</span>
            </button>
        `;

        document.getElementById('scene-mode').appendChild(this.element);

        this.element.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.setTool(btn.dataset.tool);
            });
        });

        this._initFileMenu();
        this._initDrawMenu();

        this.element.addEventListener('mousedown', (e) => e.stopPropagation());
        this.element.addEventListener('mouseup', (e) => e.stopPropagation());
        this.element.addEventListener('click', (e) => e.stopPropagation());

        if (EditorToolbar.currentKeyHandler) {
            document.removeEventListener('keydown', EditorToolbar.currentKeyHandler);
        }

        this._boundKeyHandler = (e) => {
            if (e.repeat) return;
            if (e.target.tagName === 'INPUT') return;
            switch(e.code) {
                case 'KeyV': this.setTool('select'); break;
                case 'KeyM': this.setTool('move'); break;
                case 'KeyD': this.setTool('draw'); break;
                case 'KeyR': this.setTool('measure'); break;
                case 'KeyP': this.setTool('potential'); break;
                case 'KeyT': this.setTool('tree'); break;
                case 'KeyS': 
                    // Solar Radiation toggle
                    if (window.app?.controllers?.solarRadiation) {
                        window.app.controllers.solarRadiation.togglePanel();
                    }
                    break;
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

        menuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropdown.classList.toggle('visible');
        });

        document.addEventListener('click', (e) => {
            if (!fileMenu.contains(e.target)) {
                dropdown.classList.remove('visible');
            }
        });

        dropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = item.dataset.action;
                dropdown.classList.remove('visible');

                switch (action) {
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
                    case 'cfd-analysis':
                        if (window.showCFDPanel) {
                            window.showCFDPanel();
                        }
                        break;
                    case 'solar-radiation-menu':
                        if (window.app?.controllers?.solarRadiation) {
                            window.app.controllers.solarRadiation.showPanel();
                        }
                        break;
                }
            });
        });
    }

    _initDrawMenu() {
        const drawMenu = this.element.querySelector('.draw-menu');
        if (!drawMenu) return;

        const btn = drawMenu.querySelector('.draw-menu-btn');
        const dropdown = drawMenu.querySelector('.draw-menu-dropdown');

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropdown.classList.toggle('visible');
        });

        document.addEventListener('click', (e) => {
            if (!drawMenu.contains(e.target)) {
                dropdown.classList.remove('visible');
            }
        });

        dropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const mode = item.dataset.drawMode;
                dropdown.classList.remove('visible');
                this.drawMode = mode;
                const icon = btn.querySelector('.tool-icon');
                icon.textContent = mode === 'rect' ? '▭' : '✏';
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
        if (tool === this.currentTool) return;

        const prevTool = this.currentTool;
        this.currentTool = tool;

        this.element.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        this.onChange(tool, prevTool);
        console.log(`[EditorToolbar] Инструмент: ${tool}`);
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