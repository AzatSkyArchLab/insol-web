/**
 * ============================================
 * MeasureTool.js
 * Инструмент измерения расстояний в 3D сцене
 * Интегрирован с MeasureRenderer3D
 * ============================================
 */

class MeasureTool {
    constructor(sceneManager, options = {}) {
        this.sceneManager = sceneManager;
        this.measureRenderer = null; // Устанавливается через setRenderer
        this.enabled = false;
        
        // Режим: 'line' | 'polygon'
        this.mode = 'line';
        
        // Текущие точки измерения (Vector3)
        this.points = [];
        this.maxPoints = options.maxPoints || 20;
        
        // Группа для preview объектов
        this.previewGroup = new THREE.Group();
        this.previewGroup.name = 'measure-tool-preview';
        this.sceneManager.scene.add(this.previewGroup);
        
        // Материалы
        this.pointMaterial = new THREE.MeshBasicMaterial({ color: 0xff4444 });
        this.lineMaterial = new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 2 });
        this.previewLineMaterial = new THREE.LineBasicMaterial({ 
            color: 0xff8888, 
            linewidth: 1, 
            transparent: true, 
            opacity: 0.6 
        });
        this.polygonPreviewMaterial = new THREE.MeshBasicMaterial({
            color: 0xff4444,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide
        });
        
        // Текущая линия предпросмотра к курсору
        this.cursorLine = null;
        
        // Raycaster
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Обработчики
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onDblClick = this._onDblClick.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        
        // DOM элементы
        this.infoPanel = null;
        
        console.log('[MeasureTool] Создан');
    }
    
    setRenderer(renderer) {
        this.measureRenderer = renderer;
    }
    
    enable() {
        if (this.enabled) return;
        this.enabled = true;
        
        const canvas = this.sceneManager.renderer.domElement;
        canvas.addEventListener('mousemove', this._onMouseMove);
        canvas.addEventListener('mousedown', this._onMouseDown);
        canvas.addEventListener('dblclick', this._onDblClick);
        document.addEventListener('keydown', this._onKeyDown);
        
        canvas.style.cursor = 'crosshair';
        
        this._createInfoPanel();
        
        console.log('[MeasureTool] Включен');
    }
    
    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        
        const canvas = this.sceneManager.renderer.domElement;
        canvas.removeEventListener('mousemove', this._onMouseMove);
        canvas.removeEventListener('mousedown', this._onMouseDown);
        canvas.removeEventListener('dblclick', this._onDblClick);
        document.removeEventListener('keydown', this._onKeyDown);
        
        canvas.style.cursor = '';
        
        this._clearPreview();
        this._hideInfoPanel();
        
        console.log('[MeasureTool] Выключен');
    }
    
    setMode(mode) {
        if (mode !== 'line' && mode !== 'polygon') return;
        this.mode = mode;
        this._clearPreview();
        this._updateModeButtons();
        console.log(`[MeasureTool] Режим: ${mode}`);
    }
    
    _onMouseMove(e) {
        if (!this.enabled) return;
        
        const point = this._getIntersectionPoint(e);
        if (!point) return;
        
        this._updateCursorLine(point);
    }
    
    _onMouseDown(e) {
        if (!this.enabled || e.button !== 0) return;
        
        // Игнорируем клики по UI
        if (e.target.closest('.editor-toolbar') || 
            e.target.closest('#building-card') ||
            e.target.closest('#scene-panel') ||
            e.target.closest('#scene-view-controls') ||
            e.target.closest('#scene-layer-switcher') ||
            e.target.closest('#measure-tool-panel')) return;
        
        const point = this._getIntersectionPoint(e);
        if (!point) return;
        
        this._addPoint(point);
    }
    
    _onDblClick(e) {
        if (!this.enabled) return;
        e.preventDefault();
        
        // Убираем последнюю точку (добавленную первым кликом dblclick)
        if (this.points.length > 0) {
            this.points.pop();
            this._updatePreview();
        }
        
        this._finishMeasurement();
    }
    
    _onKeyDown(e) {
        if (!this.enabled) return;
        
        if (e.code === 'Escape') {
            this._clearPreview();
        } else if (e.code === 'Enter' || e.code === 'Space') {
            e.preventDefault();
            this._finishMeasurement();
        }
    }
    
    _getIntersectionPoint(e) {
        const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);
        
        // Ищем пересечение со зданиями и землёй
        const targets = [
            ...this.sceneManager.buildings.children,
            ...this.sceneManager.ground.children
        ];
        
        const intersects = this.raycaster.intersectObjects(targets, true);
        
        if (intersects.length > 0) {
            return intersects[0].point.clone();
        }
        
        // Fallback - плоскость Z=0
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const target = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(plane, target);
        return target;
    }
    
    _addPoint(point) {
        if (this.points.length >= this.maxPoints) {
            console.log('[MeasureTool] Достигнут лимит точек');
            return;
        }
        
        this.points.push(point.clone());
        this._updatePreview();
        this._updateInfoPanel();
    }
    
    _updatePreview() {
        // Очищаем preview группу
        while (this.previewGroup.children.length > 0) {
            const child = this.previewGroup.children[0];
            if (child.geometry) child.geometry.dispose();
            this.previewGroup.remove(child);
        }
        
        if (this.points.length === 0) return;
        
        // Точки
        this.points.forEach(p => {
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(1.2, 16, 16),
                this.pointMaterial
            );
            sphere.position.copy(p);
            this.previewGroup.add(sphere);
        });
        
        // Линии между точками
        if (this.points.length >= 2) {
            const linePoints = this.points.map(p => p.clone());
            const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
            const line = new THREE.Line(geometry, this.lineMaterial);
            this.previewGroup.add(line);
        }
        
        // Полигон preview
        if (this.mode === 'polygon' && this.points.length >= 3) {
            const shape = new THREE.Shape();
            shape.moveTo(this.points[0].x, this.points[0].y);
            for (let i = 1; i < this.points.length; i++) {
                shape.lineTo(this.points[i].x, this.points[i].y);
            }
            shape.closePath();
            
            const geometry = new THREE.ShapeGeometry(shape);
            const mesh = new THREE.Mesh(geometry, this.polygonPreviewMaterial);
            mesh.position.z = 0.3;
            this.previewGroup.add(mesh);
            
            // Замыкающая линия
            const closeGeometry = new THREE.BufferGeometry().setFromPoints([
                this.points[this.points.length - 1],
                this.points[0]
            ]);
            const closeLine = new THREE.Line(closeGeometry, this.previewLineMaterial);
            this.previewGroup.add(closeLine);
        }
    }
    
    _updateCursorLine(cursorPoint) {
        // Удаляем старую линию курсора
        if (this.cursorLine) {
            if (this.cursorLine.geometry) this.cursorLine.geometry.dispose();
            this.previewGroup.remove(this.cursorLine);
            this.cursorLine = null;
        }
        
        if (this.points.length === 0) return;
        
        const lastPoint = this.points[this.points.length - 1];
        const geometry = new THREE.BufferGeometry().setFromPoints([lastPoint, cursorPoint]);
        this.cursorLine = new THREE.Line(geometry, this.previewLineMaterial);
        this.previewGroup.add(this.cursorLine);
    }
    
    _finishMeasurement() {
        const minPoints = this.mode === 'polygon' ? 3 : 2;
        
        if (this.points.length < minPoints) {
            console.log(`[MeasureTool] Недостаточно точек (нужно минимум ${minPoints})`);
            this._clearPreview();
            return;
        }
        
        // Добавляем измерение через renderer
        if (this.measureRenderer) {
            this.measureRenderer.addMeasurementFromScene(this.points, this.mode);
        }
        
        this._clearPreview();
        this._updateInfoPanel();
    }
    
    _clearPreview() {
        this.points = [];
        
        while (this.previewGroup.children.length > 0) {
            const child = this.previewGroup.children[0];
            if (child.geometry) child.geometry.dispose();
            this.previewGroup.remove(child);
        }
        
        this.cursorLine = null;
        this._updateInfoPanel();
    }
    
    _createInfoPanel() {
        if (this.infoPanel) {
            this.infoPanel.classList.add('visible');
            return;
        }
        
        this.infoPanel = document.createElement('div');
        this.infoPanel.id = 'measure-tool-panel';
        this.infoPanel.innerHTML = `
            <div class="measure-panel-header">
                <span>📏 Линейка</span>
                <button class="measure-close-btn" title="Закрыть">✕</button>
            </div>
            <div class="measure-mode-btns">
                <button class="measure-mode-btn active" data-mode="line">
                    <span>📏</span> Линия
                </button>
                <button class="measure-mode-btn" data-mode="polygon">
                    <span>⬡</span> Полигон
                </button>
            </div>
            <div class="measure-info">
                <div class="measure-hint">Кликайте для измерения</div>
                <div class="measure-stats"></div>
            </div>
            <div class="measure-actions">
                <button class="measure-action-btn" data-action="finish" disabled>✓ Завершить</button>
                <button class="measure-action-btn" data-action="clear">✕ Сбросить</button>
            </div>
        `;
        document.getElementById('scene-container').appendChild(this.infoPanel);
        
        this._bindPanelEvents();
        this.infoPanel.classList.add('visible');
    }
    
    _bindPanelEvents() {
        // Кнопка закрытия
        this.infoPanel.querySelector('.measure-close-btn').addEventListener('click', () => {
            // Переключаемся на select
            window.app?.state?.editorToolbar?.setTool('select');
        });
        
        // Переключатели режима
        this.infoPanel.querySelectorAll('.measure-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setMode(btn.dataset.mode);
            });
        });
        
        // Кнопки действий
        this.infoPanel.querySelectorAll('.measure-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'finish') {
                    this._finishMeasurement();
                } else if (action === 'clear') {
                    this._clearPreview();
                }
            });
        });
    }
    
    _updateModeButtons() {
        this.infoPanel?.querySelectorAll('.measure-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === this.mode);
        });
    }
    
    _updateInfoPanel() {
        if (!this.infoPanel) return;
        
        const stats = this.infoPanel.querySelector('.measure-stats');
        const finishBtn = this.infoPanel.querySelector('[data-action="finish"]');
        
        if (this.points.length === 0) {
            stats.innerHTML = '';
            finishBtn.disabled = true;
            return;
        }
        
        // Расстояние
        let distance = 0;
        for (let i = 1; i < this.points.length; i++) {
            distance += this.points[i - 1].distanceTo(this.points[i]);
        }
        
        let html = `<strong>Расстояние:</strong> ${this._formatDistance(distance)}`;
        
        // Площадь для полигона
        if (this.mode === 'polygon' && this.points.length >= 3) {
            const area = this._calculateArea();
            html += `<br><strong>Площадь:</strong> ${this._formatArea(area)}`;
        }
        
        html += `<br><small>Точек: ${this.points.length}</small>`;
        stats.innerHTML = html;
        
        const minPoints = this.mode === 'polygon' ? 3 : 2;
        finishBtn.disabled = this.points.length < minPoints;
    }
    
    _hideInfoPanel() {
        if (this.infoPanel) {
            this.infoPanel.classList.remove('visible');
        }
    }
    
    _calculateArea() {
        if (this.points.length < 3) return 0;
        
        let area = 0;
        for (let i = 0; i < this.points.length; i++) {
            const j = (i + 1) % this.points.length;
            area += this.points[i].x * this.points[j].y;
            area -= this.points[j].x * this.points[i].y;
        }
        
        return Math.abs(area) / 2;
    }
    
    _formatDistance(meters) {
        if (meters < 1) return `${(meters * 100).toFixed(0)} см`;
        if (meters < 1000) return `${meters.toFixed(1)} м`;
        return `${(meters / 1000).toFixed(2)} км`;
    }
    
    _formatArea(sqMeters) {
        if (sqMeters < 1) return `${(sqMeters * 10000).toFixed(0)} см²`;
        if (sqMeters < 10000) return `${sqMeters.toFixed(1)} м²`;
        if (sqMeters < 1000000) return `${(sqMeters / 10000).toFixed(2)} сот.`;
        return `${(sqMeters / 1000000).toFixed(3)} км²`;
    }
    
    dispose() {
        this.disable();
        this._clearPreview();
        this.sceneManager.scene.remove(this.previewGroup);
        
        this.pointMaterial.dispose();
        this.lineMaterial.dispose();
        this.previewLineMaterial.dispose();
        this.polygonPreviewMaterial.dispose();
        
        if (this.infoPanel) {
            this.infoPanel.remove();
        }
    }
}

export { MeasureTool };
window.MeasureTool = MeasureTool;