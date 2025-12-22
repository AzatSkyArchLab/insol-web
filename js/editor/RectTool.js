/**
 * ============================================
 * RectTool.js
 * Инструмент рисования прямоугольников
 * 
 * Workflow:
 * 1. Первый клик - начало линии основания
 * 2. Второй клик - конец линии (показывается длина)
 * 3. Движение мыши - выдавливание перпендикулярно
 * 4. Третий клик - завершение (создаётся здание)
 * ============================================
 */

class RectTool {
    constructor(sceneManager, coords, options = {}) {
        this.sceneManager = sceneManager;
        this.coords = coords;
        
        // Callbacks
        this.onCreate = options.onCreate || (() => {});
        
        // Состояние
        this.enabled = false;
        this.phase = 0;  // 0 = ждём первую точку, 1 = ждём вторую, 2 = выдавливание
        
        // Точки
        this.p1 = null;  // Начало линии
        this.p2 = null;  // Конец линии
        this.p3 = null;  // Точка выдавливания
        this.currentMouse = null;
        
        // Визуализация
        this.baseLine = null;      // Линия основания
        this.extrudeLine = null;   // Линия выдавливания
        this.previewMesh = null;   // Превью прямоугольника
        this.labelDiv = null;      // Div для размеров
        
        // Материалы
        this.lineMaterial = new THREE.LineBasicMaterial({ 
            color: 0x1a73e8,
            linewidth: 2
        });
        
        this.previewMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x1a73e8, 
            transparent: true, 
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        
        // Привязываем обработчики
        this._onClick = this._onClick.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        
        // Raycaster
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Создаём label
        this._createLabel();
    }
    
    /**
     * Включить инструмент
     */
    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.phase = 0;
        
        const container = this.sceneManager.renderer.domElement;
        container.addEventListener('click', this._onClick);
        container.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('keydown', this._onKeyDown);
        
        container.style.cursor = 'crosshair';
        
        console.log('[RectTool] Включён');
    }
    
    /**
     * Выключить инструмент
     */
    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        
        const container = this.sceneManager.renderer.domElement;
        container.removeEventListener('click', this._onClick);
        container.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('keydown', this._onKeyDown);
        
        container.style.cursor = 'default';
        
        this._clearAll();
        
        console.log('[RectTool] Выключён');
    }
    
    /**
     * Создать label для размеров
     */
    _createLabel() {
        this.labelDiv = document.createElement('div');
        this.labelDiv.id = 'rect-tool-label';
        this.labelDiv.style.cssText = `
            position: fixed;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-family: monospace;
            pointer-events: none;
            z-index: 10000;
            display: none;
            white-space: nowrap;
        `;
        document.body.appendChild(this.labelDiv);
    }
    
    /**
     * Показать label с размерами
     */
    _showLabel(text, screenX, screenY) {
        this.labelDiv.textContent = text;
        this.labelDiv.style.left = (screenX + 15) + 'px';
        this.labelDiv.style.top = (screenY - 10) + 'px';
        this.labelDiv.style.display = 'block';
    }
    
    /**
     * Скрыть label
     */
    _hideLabel() {
        this.labelDiv.style.display = 'none';
    }
    
    /**
     * Получить точку на плоскости z=0
     */
    _getGroundPoint(event) {
        const container = this.sceneManager.renderer.domElement;
        const rect = container.getBoundingClientRect();
        
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);
        
        // Пересечение с плоскостью z=0
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const intersection = new THREE.Vector3();
        
        if (this.raycaster.ray.intersectPlane(plane, intersection)) {
            return intersection;
        }
        
        return null;
    }
    
    /**
     * Обработка клика мыши
     */
    _onClick(event) {
        if (event.button !== 0) return;  // Только левая кнопка
        
        const point = this._getGroundPoint(event);
        if (!point) return;
        
        if (this.phase === 0) {
            // Первая точка - начало линии
            this.p1 = point.clone();
            this.phase = 1;
            console.log('[RectTool] Точка 1:', this.p1.x.toFixed(1), this.p1.y.toFixed(1));
            
        } else if (this.phase === 1) {
            // Вторая точка - конец линии
            this.p2 = point.clone();
            this.phase = 2;
            
            const length = this.p1.distanceTo(this.p2);
            console.log('[RectTool] Точка 2:', this.p2.x.toFixed(1), this.p2.y.toFixed(1), '| Длина:', length.toFixed(1));
            
            // Фиксируем линию основания
            this._updateBaseLine();
            
        } else if (this.phase === 2) {
            // Третья точка - завершение выдавливания
            this._finishRect();
        }
    }
    
    /**
     * Обработка движения мыши
     */
    _onMouseMove(event) {
        const point = this._getGroundPoint(event);
        if (!point) return;
        
        this.currentMouse = point;
        
        if (this.phase === 1 && this.p1) {
            // Рисуем линию от p1 до курсора
            this._updateBaseLine(point);
            
            const length = this.p1.distanceTo(point);
            this._showLabel(`${length.toFixed(1)} м`, event.clientX, event.clientY);
            
        } else if (this.phase === 2 && this.p1 && this.p2) {
            // Выдавливание - показываем прямоугольник
            this._updateExtrusion(point, event);
        }
    }
    
    /**
     * Обновить линию основания
     */
    _updateBaseLine(endPoint = null) {
        const end = endPoint || this.p2;
        if (!this.p1 || !end) return;
        
        // Удаляем старую линию
        if (this.baseLine) {
            this.sceneManager.scene.remove(this.baseLine);
            this.baseLine.geometry.dispose();
        }
        
        // Создаём новую
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(this.p1.x, this.p1.y, 0.5),
            new THREE.Vector3(end.x, end.y, 0.5)
        ]);
        
        this.baseLine = new THREE.Line(geometry, this.lineMaterial);
        this.sceneManager.scene.add(this.baseLine);
    }
    
    /**
     * Обновить выдавливание
     */
    _updateExtrusion(mousePoint, event) {
        // Вектор линии основания
        const baseVec = new THREE.Vector2(
            this.p2.x - this.p1.x,
            this.p2.y - this.p1.y
        );
        const baseLength = baseVec.length();
        
        // Нормализованный вектор
        const baseDir = baseVec.clone().normalize();
        
        // Перпендикуляр (поворот на 90°)
        const perpDir = new THREE.Vector2(-baseDir.y, baseDir.x);
        
        // Вектор от p1 к курсору
        const toMouse = new THREE.Vector2(
            mousePoint.x - this.p1.x,
            mousePoint.y - this.p1.y
        );
        
        // Проекция на перпендикуляр = ширина выдавливания
        const width = toMouse.dot(perpDir);
        
        // 4 угла прямоугольника
        const corners = this._getRectCorners(width);
        
        // Обновляем превью
        this._updatePreviewMesh(corners);
        
        // Показываем размеры
        const absWidth = Math.abs(width);
        this._showLabel(`${baseLength.toFixed(1)} × ${absWidth.toFixed(1)} м`, event.clientX, event.clientY);
    }
    
    /**
     * Получить 4 угла прямоугольника
     */
    _getRectCorners(width) {
        const baseDir = new THREE.Vector2(
            this.p2.x - this.p1.x,
            this.p2.y - this.p1.y
        ).normalize();
        
        const perpDir = new THREE.Vector2(-baseDir.y, baseDir.x);
        
        // Смещение по перпендикуляру
        const offsetX = perpDir.x * width;
        const offsetY = perpDir.y * width;
        
        return [
            { x: this.p1.x, y: this.p1.y },
            { x: this.p2.x, y: this.p2.y },
            { x: this.p2.x + offsetX, y: this.p2.y + offsetY },
            { x: this.p1.x + offsetX, y: this.p1.y + offsetY }
        ];
    }
    
    /**
     * Обновить превью меш
     */
    _updatePreviewMesh(corners) {
        // Удаляем старый
        if (this.previewMesh) {
            this.sceneManager.scene.remove(this.previewMesh);
            this.previewMesh.geometry.dispose();
        }
        
        // Создаём Shape
        const shape = new THREE.Shape();
        shape.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) {
            shape.lineTo(corners[i].x, corners[i].y);
        }
        shape.closePath();
        
        // Геометрия
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.translate(0, 0, 0.5);
        
        this.previewMesh = new THREE.Mesh(geometry, this.previewMaterial);
        this.sceneManager.scene.add(this.previewMesh);
    }
    
    /**
     * Завершить рисование прямоугольника
     */
    _finishRect() {
        if (!this.p1 || !this.p2 || !this.currentMouse) return;
        
        // Вычисляем ширину
        const baseDir = new THREE.Vector2(
            this.p2.x - this.p1.x,
            this.p2.y - this.p1.y
        ).normalize();
        
        const perpDir = new THREE.Vector2(-baseDir.y, baseDir.x);
        
        const toMouse = new THREE.Vector2(
            this.currentMouse.x - this.p1.x,
            this.currentMouse.y - this.p1.y
        );
        
        const width = toMouse.dot(perpDir);
        
        if (Math.abs(width) < 1) {
            console.log('[RectTool] Слишком маленькая ширина');
            return;
        }
        
        // Получаем углы
        const corners = this._getRectCorners(width);
        
        // Создаём здание
        this._createBuilding(corners);
        
        // Сброс
        this._clearAll();
        this.phase = 0;
    }
    
    /**
     * Создать здание из углов
     */
    _createBuilding(corners) {
        const defaultHeight = 9;
        
        // Shape для экструзии
        const shape = new THREE.Shape();
        shape.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) {
            shape.lineTo(corners[i].x, corners[i].y);
        }
        shape.closePath();
        
        // Экструзия
        const extrudeSettings = {
            steps: 1,
            depth: defaultHeight,
            bevelEnabled: false
        };
        
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        
        // Материал как у обычных зданий
        const material = new THREE.MeshLambertMaterial({ 
            color: 0x5b8dd9,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        
        // Метаданные
        mesh.userData = {
            id: 'building-' + Date.now(),
            type: 'building',
            basePoints: corners,
            properties: {
                height: defaultHeight,
                floors: Math.round(defaultHeight / 3),
                isResidential: true
            }
        };
        
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
        
        // Добавляем в сцену
        const group = this.sceneManager.getBuildingsGroup();
        group.add(mesh);
        
        console.log('[RectTool] Создано здание:', mesh.userData.id);
        
        // Callback
        this.onCreate(mesh);
    }
    
    /**
     * Обработка клавиш
     */
    _onKeyDown(event) {
        if (event.code === 'Escape') {
            // Отмена текущего рисования
            this._clearAll();
            this.phase = 0;
            console.log('[RectTool] Отменено');
        }
    }
    
    /**
     * Очистить всё
     */
    _clearAll() {
        if (this.baseLine) {
            this.sceneManager.scene.remove(this.baseLine);
            this.baseLine.geometry.dispose();
            this.baseLine = null;
        }
        
        if (this.extrudeLine) {
            this.sceneManager.scene.remove(this.extrudeLine);
            this.extrudeLine.geometry.dispose();
            this.extrudeLine = null;
        }
        
        if (this.previewMesh) {
            this.sceneManager.scene.remove(this.previewMesh);
            this.previewMesh.geometry.dispose();
            this.previewMesh = null;
        }
        
        this._hideLabel();
        
        this.p1 = null;
        this.p2 = null;
        this.p3 = null;
        this.currentMouse = null;
    }
    
    /**
     * Уничтожить инструмент
     */
    dispose() {
        this.disable();
        
        if (this.labelDiv && this.labelDiv.parentNode) {
            this.labelDiv.parentNode.removeChild(this.labelDiv);
        }
        
        if (this.lineMaterial) this.lineMaterial.dispose();
        if (this.previewMaterial) this.previewMaterial.dispose();
    }
}

// ES6 экспорт
export { RectTool };