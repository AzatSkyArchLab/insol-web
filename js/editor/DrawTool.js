/**
 * ============================================
 * DrawTool.js
 * Инструмент рисования полигонов
 * ============================================
 */

class DrawTool {
    constructor(sceneManager, coordinates, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        this.camera = sceneManager.camera;
        this.renderer = sceneManager.renderer;
        this.coordinates = coordinates;
        
        this.enabled = false;
        this.points = [];
        
        // Визуальные элементы
        this.previewLine = null;
        this.previewMesh = null;
        this.vertexHelpers = [];
        this.distanceLabels = [];
        this._dynamicLine = null;
        this._dynamicLabel = null;
        
        // Параметры
        this.defaultHeight = options.defaultHeight || 9;
        
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
        this.helperMaterial = new THREE.MeshBasicMaterial({ color: 0x1a73e8 });
        
        // Raycaster
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        
        // Callbacks
        this.onCreate = options.onCreate || (() => {});
        
        // Привязанные обработчики
        this._boundOnClick = this._onClick.bind(this);
        this._boundOnMouseMove = this._onMouseMove.bind(this);
        this._boundOnKeyDown = this._onKeyDown.bind(this);
        this._boundOnContextMenu = this._onContextMenu.bind(this);
        this._boundOnDblClick = this._onDblClick.bind(this);
        
        console.log('[DrawTool] Создан');
    }
    
    enable() {
        if (this.enabled) return;
        this.enabled = true;
        
        this.renderer.domElement.addEventListener('click', this._boundOnClick);
        this.renderer.domElement.addEventListener('mousemove', this._boundOnMouseMove);
        this.renderer.domElement.addEventListener('dblclick', this._boundOnDblClick);
        this.renderer.domElement.addEventListener('contextmenu', this._boundOnContextMenu);
        document.addEventListener('keydown', this._boundOnKeyDown);
        
        this.renderer.domElement.style.cursor = 'crosshair';
        
        console.log('[DrawTool] Включён');
    }
    
    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        
        this.renderer.domElement.removeEventListener('click', this._boundOnClick);
        this.renderer.domElement.removeEventListener('mousemove', this._boundOnMouseMove);
        this.renderer.domElement.removeEventListener('dblclick', this._boundOnDblClick);
        this.renderer.domElement.removeEventListener('contextmenu', this._boundOnContextMenu);
        document.removeEventListener('keydown', this._boundOnKeyDown);
        
        this.renderer.domElement.style.cursor = '';
        
        this._clearPreview();
        this.points = [];
        
        console.log('[DrawTool] Выключён');
    }
    
    _onClick(event) {
        if (event.button !== 0) return;
        
        const point = this._getGroundPoint(event);
        if (!point) return;
        
        this.points.push(point.clone());
        this._updatePreview();
        
        console.log(`[DrawTool] Точка ${this.points.length}: (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`);
    }
    
    _onDblClick(event) {
        event.preventDefault();
        if (this.points.length >= 3) {
            this._finishPolygon();
        }
    }
    
    _onContextMenu(event) {
        event.preventDefault();
        
        if (this.points.length >= 3) {
            this._finishPolygon();
        } else if (this.points.length > 0) {
            this._clearPreview();
            this.points = [];
            console.log('[DrawTool] Отменено');
        }
    }
    
    _onKeyDown(event) {
        if (!this.enabled) return;
        
        switch(event.code) {
            case 'Enter':
                if (this.points.length >= 3) {
                    this._finishPolygon();
                }
                break;
            case 'Escape':
                this._clearPreview();
                this.points = [];
                console.log('[DrawTool] Отменено');
                break;
            case 'Backspace':
                if (this.points.length > 0) {
                    this.points.pop();
                    this._updatePreview();
                    console.log('[DrawTool] Удалена последняя точка');
                }
                break;
        }
    }
    
    _onMouseMove(event) {
        if (this.points.length === 0) return;
        
        const point = this._getGroundPoint(event);
        if (!point) return;
        
        this._updatePreviewLine(point);
        this._updateDynamicLabel(point);
    }
    
    _getGroundPoint(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const intersection = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.groundPlane, intersection)) {
            return intersection;
        }
        return null;
    }
    
    /**
     * Создать подпись с расстоянием
     */
    _createDistanceLabel(distance, position) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 48;
        
        const ctx = canvas.getContext('2d');
        
        // Фон
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.beginPath();
        ctx.roundRect(4, 8, 120, 32, 6);
        ctx.fill();
        
        // Рамка
        ctx.strokeStyle = '#1a73e8';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Текст
        ctx.fillStyle = '#202124';
        ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${distance.toFixed(1)} м`, 64, 24);
        
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ 
            map: texture, 
            transparent: true,
            depthTest: false,
            depthWrite: false,
            sizeAttenuation: false
        });
        
        const sprite = new THREE.Sprite(material);
        sprite.position.copy(position);
        sprite.position.z = 3;
        sprite.scale.set(0.12, 0.05, 1);
        sprite.renderOrder = 1000;
        
        return sprite;
    }
    
    _updatePreview() {
        this._clearPreview();
        
        if (this.points.length === 0) return;
        
        // Вершины-хелперы
        this.points.forEach((p) => {
            const geometry = new THREE.SphereGeometry(0.5, 16, 16);
            const mesh = new THREE.Mesh(geometry, this.helperMaterial.clone());
            mesh.position.copy(p);
            mesh.position.z = 0.1;
            this.scene.add(mesh);
            this.vertexHelpers.push(mesh);
        });
        
        // Линии между точками
        if (this.points.length >= 2) {
            const linePoints = [...this.points];
            if (this.points.length >= 3) {
                linePoints.push(this.points[0]); // Замыкаем
            }
            const geometry = new THREE.BufferGeometry().setFromPoints(
                linePoints.map(p => new THREE.Vector3(p.x, p.y, 0.1))
            );
            this.previewLine = new THREE.Line(geometry, this.lineMaterial);
            this.scene.add(this.previewLine);
        }
        
        // Заливка полигона
        if (this.points.length >= 3) {
            const shape = new THREE.Shape();
            shape.moveTo(this.points[0].x, this.points[0].y);
            for (let i = 1; i < this.points.length; i++) {
                shape.lineTo(this.points[i].x, this.points[i].y);
            }
            shape.closePath();
            
            const geometry = new THREE.ShapeGeometry(shape);
            this.previewMesh = new THREE.Mesh(geometry, this.previewMaterial);
            this.previewMesh.position.z = 0.05;
            this.scene.add(this.previewMesh);
        }
        
        // Подписи расстояний между точками
        this._updateDistanceLabels();
    }
    
    /**
     * Обновить подписи расстояний для всех рёбер
     */
    _updateDistanceLabels() {
        // Очищаем старые
        this.distanceLabels.forEach(label => {
            if (label.material.map) label.material.map.dispose();
            label.material.dispose();
            this.scene.remove(label);
        });
        this.distanceLabels = [];
        
        if (this.points.length < 2) return;
        
        // Подписи для каждого ребра
        for (let i = 0; i < this.points.length - 1; i++) {
            const p1 = this.points[i];
            const p2 = this.points[i + 1];
            
            const distance = Math.sqrt(
                Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
            );
            
            const midPoint = new THREE.Vector3(
                (p1.x + p2.x) / 2,
                (p1.y + p2.y) / 2,
                0
            );
            
            const label = this._createDistanceLabel(distance, midPoint);
            this.scene.add(label);
            this.distanceLabels.push(label);
        }
        
        // Замыкающее ребро (если 3+ точки)
        if (this.points.length >= 3) {
            const p1 = this.points[this.points.length - 1];
            const p2 = this.points[0];
            
            const distance = Math.sqrt(
                Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
            );
            
            const midPoint = new THREE.Vector3(
                (p1.x + p2.x) / 2,
                (p1.y + p2.y) / 2,
                0
            );
            
            const label = this._createDistanceLabel(distance, midPoint);
            this.scene.add(label);
            this.distanceLabels.push(label);
        }
    }
    
    _updatePreviewLine(currentPoint) {
        if (this.points.length === 0) return;
        
        const lastPoint = this.points[this.points.length - 1];
        
        // Удаляем старую динамическую линию
        if (this._dynamicLine) {
            this._dynamicLine.geometry.dispose();
            this.scene.remove(this._dynamicLine);
        }
        
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(lastPoint.x, lastPoint.y, 0.1),
            new THREE.Vector3(currentPoint.x, currentPoint.y, 0.1)
        ]);
        
        this._dynamicLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({ 
            color: 0x1a73e8, 
            opacity: 0.6, 
            transparent: true 
        }));
        this.scene.add(this._dynamicLine);
    }
    
    /**
     * Обновить динамическую подпись (от последней точки до курсора)
     */
    _updateDynamicLabel(currentPoint) {
        // Удаляем старую
        if (this._dynamicLabel) {
            if (this._dynamicLabel.material.map) this._dynamicLabel.material.map.dispose();
            this._dynamicLabel.material.dispose();
            this.scene.remove(this._dynamicLabel);
            this._dynamicLabel = null;
        }
        
        if (this.points.length === 0) return;
        
        const lastPoint = this.points[this.points.length - 1];
        const distance = Math.sqrt(
            Math.pow(currentPoint.x - lastPoint.x, 2) + 
            Math.pow(currentPoint.y - lastPoint.y, 2)
        );
        
        // Не показывать если слишком близко
        if (distance < 0.5) return;
        
        const midPoint = new THREE.Vector3(
            (lastPoint.x + currentPoint.x) / 2,
            (lastPoint.y + currentPoint.y) / 2,
            0
        );
        
        this._dynamicLabel = this._createDistanceLabel(distance, midPoint);
        this.scene.add(this._dynamicLabel);
    }
    
    _clearPreview() {
        // Хелперы вершин
        this.vertexHelpers.forEach(h => {
            h.geometry.dispose();
            h.material.dispose();
            this.scene.remove(h);
        });
        this.vertexHelpers = [];
        
        // Линия контура
        if (this.previewLine) {
            this.previewLine.geometry.dispose();
            this.scene.remove(this.previewLine);
            this.previewLine = null;
        }
        
        // Заливка
        if (this.previewMesh) {
            this.previewMesh.geometry.dispose();
            this.scene.remove(this.previewMesh);
            this.previewMesh = null;
        }
        
        // Динамическая линия
        if (this._dynamicLine) {
            this._dynamicLine.geometry.dispose();
            this.scene.remove(this._dynamicLine);
            this._dynamicLine = null;
        }
        
        // Подписи расстояний
        this.distanceLabels.forEach(label => {
            if (label.material.map) label.material.map.dispose();
            label.material.dispose();
            this.scene.remove(label);
        });
        this.distanceLabels = [];
        
        // Динамическая подпись
        if (this._dynamicLabel) {
            if (this._dynamicLabel.material.map) this._dynamicLabel.material.map.dispose();
            this._dynamicLabel.material.dispose();
            this.scene.remove(this._dynamicLabel);
            this._dynamicLabel = null;
        }
    }
    
    _finishPolygon() {
        if (this.points.length < 3) return;
        
        // Создаём Shape
        const shape = new THREE.Shape();
        shape.moveTo(this.points[0].x, this.points[0].y);
        for (let i = 1; i < this.points.length; i++) {
            shape.lineTo(this.points[i].x, this.points[i].y);
        }
        shape.closePath();
        
        // Создаём 3D здание
        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: this.defaultHeight,
            bevelEnabled: false
        });
        
        // важно для raycasting!
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        
        const material = new THREE.MeshLambertMaterial({ 
            color: 0x5b8dd9,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = {
            id: 'building-' + Date.now(),
            type: 'building',
            properties: {
                height: this.defaultHeight,
                levels: Math.round(this.defaultHeight / 3),
                isResidential: true,
                heightSource: 'default'
            },
            basePoints: this.points.map(p => ({ x: p.x, y: p.y }))
        };
        mesh.userData.originalColor = 0x5b8dd9;
        
        // Обновляем матрицы для raycaster
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
        
        // Добавляем в группу зданий
        const group = this.sceneManager.getBuildingsGroup();
        group.add(mesh);
        
        console.log(`[DrawTool] Создано здание: ${mesh.userData.id}`);
        
        // Очищаем
        this._clearPreview();
        this.points = [];
        
        // Callback
        this.onCreate(mesh);
    }
}

export { DrawTool };
window.DrawTool = DrawTool;