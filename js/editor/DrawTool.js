/**
 * ============================================
 * DrawTool.js
 * Рисование новых полигонов
 * ============================================
 */

class DrawTool {
    constructor(sceneManager, coordinates, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        this.camera = sceneManager.camera;
        this.renderer = sceneManager.renderer;
        this.controls = sceneManager.controls;
        this.buildingsGroup = sceneManager.getBuildingsGroup();
        this.coordinates = coordinates;
        
        this.enabled = false;
        this.points = [];
        this.previewLine = null;
        this.previewMesh = null;
        this.vertexHelpers = [];
        
        this.defaultHeight = 9;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        
        this.lineMaterial = new THREE.LineBasicMaterial({ color: 0x4a90d9, linewidth: 2 });
        this.previewMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x4a90d9, 
            transparent: true, 
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        this.vertexMaterial = new THREE.MeshBasicMaterial({ color: 0x4a90d9 });
        
        this.onCreate = options.onCreate || (() => {});
        
        this._boundOnClick = this._onClick.bind(this);
        this._boundOnMouseMove = this._onMouseMove.bind(this);
        this._boundOnDblClick = this._onDblClick.bind(this);
        this._boundOnContextMenu = this._onContextMenu.bind(this);
        this._boundOnKeyDown = this._onKeyDown.bind(this);
        
        console.log('[DrawTool] Создан');
    }
    
    enable() {
        this.enabled = true;
        this.renderer.domElement.addEventListener('click', this._boundOnClick);
        this.renderer.domElement.addEventListener('mousemove', this._boundOnMouseMove);
        this.renderer.domElement.addEventListener('dblclick', this._boundOnDblClick);
        this.renderer.domElement.addEventListener('contextmenu', this._boundOnContextMenu);
        document.addEventListener('keydown', this._boundOnKeyDown);
        this.renderer.domElement.style.cursor = 'crosshair';
        console.log('[DrawTool] Включен');
    }
    
    disable() {
        this.enabled = false;
        this.renderer.domElement.removeEventListener('click', this._boundOnClick);
        this.renderer.domElement.removeEventListener('mousemove', this._boundOnMouseMove);
        this.renderer.domElement.removeEventListener('dblclick', this._boundOnDblClick);
        this.renderer.domElement.removeEventListener('contextmenu', this._boundOnContextMenu);
        document.removeEventListener('keydown', this._boundOnKeyDown);
        this.renderer.domElement.style.cursor = 'default';
        this._clearPreview();
        console.log('[DrawTool] Выключен');
    }
    
    _getMousePosition(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    
    _getGroundPoint(event) {
        this._getMousePosition(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const point = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(this.groundPlane, point);
        return point;
    }
    
    _onClick(event) {
        if (event.button !== 0) return; // Только левый клик
        if (event.detail > 1) return; // Игнорируем двойной клик
        
        const point = this._getGroundPoint(event);
        
        // Проверяем замыкание (клик рядом с первой точкой)
        if (this.points.length >= 3) {
            const first = this.points[0];
            const dist = Math.sqrt((point.x - first.x) ** 2 + (point.y - first.y) ** 2);
            if (dist < 3) {
                this._finishPolygon();
                return;
            }
        }
        
        this.points.push(new THREE.Vector2(point.x, point.y));
        this._addVertexHelper(point);
        this._updatePreview();
    }
    
    _onMouseMove(event) {
        if (this.points.length === 0) return;
        
        const point = this._getGroundPoint(event);
        this._updatePreviewLine(point);
    }
    
    _onDblClick(event) {
        if (this.points.length >= 3) {
            this._finishPolygon();
        }
    }
    
    _onContextMenu(event) {
        event.preventDefault(); // Отключаем контекстное меню браузера
        
        if (this.points.length >= 3) {
            this._finishPolygon();
        } else if (this.points.length > 0) {
            // Отменяем рисование
            this._clearPreview();
        }
    }
    
    _onKeyDown(event) {
        if (event.key === 'Enter' && this.points.length >= 3) {
            this._finishPolygon();
        }
        if (event.key === 'Escape') {
            this._clearPreview();
        }
        if (event.key === 'Backspace' && this.points.length > 0) {
            this.points.pop();
            this._removeLastVertexHelper();
            this._updatePreview();
        }
    }
    
    _addVertexHelper(point) {
        const geometry = new THREE.SphereGeometry(1.5, 16, 16);
        const helper = new THREE.Mesh(geometry, this.vertexMaterial.clone());
        helper.position.set(point.x, point.y, 0.1);
        this.scene.add(helper);
        this.vertexHelpers.push(helper);
    }
    
    _removeLastVertexHelper() {
        const helper = this.vertexHelpers.pop();
        if (helper) {
            this.scene.remove(helper);
            helper.geometry.dispose();
            helper.material.dispose();
        }
    }
    
    _updatePreview() {
        if (this.previewMesh) {
            this.scene.remove(this.previewMesh);
            this.previewMesh.geometry.dispose();
            this.previewMesh = null;
        }
        
        if (this.points.length < 3) return;
        
        const shape = new THREE.Shape(this.points);
        const geometry = new THREE.ShapeGeometry(shape);
        this.previewMesh = new THREE.Mesh(geometry, this.previewMaterial);
        this.previewMesh.position.z = 0.05;
        this.scene.add(this.previewMesh);
    }
    
    _updatePreviewLine(currentPoint) {
        if (this.previewLine) {
            this.scene.remove(this.previewLine);
            this.previewLine.geometry.dispose();
        }
        
        if (this.points.length === 0) return;
        
        const linePoints = [
            ...this.points.map(p => new THREE.Vector3(p.x, p.y, 0.1)),
            new THREE.Vector3(currentPoint.x, currentPoint.y, 0.1)
        ];
        
        if (this.points.length >= 2) {
            linePoints.push(new THREE.Vector3(this.points[0].x, this.points[0].y, 0.1));
        }
        
        const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
        this.previewLine = new THREE.Line(geometry, this.lineMaterial);
        this.scene.add(this.previewLine);
    }
    
    _clearPreview() {
        if (this.previewLine) {
            this.scene.remove(this.previewLine);
            this.previewLine.geometry.dispose();
            this.previewLine = null;
        }
        
        if (this.previewMesh) {
            this.scene.remove(this.previewMesh);
            this.previewMesh.geometry.dispose();
            this.previewMesh = null;
        }
        
        this.vertexHelpers.forEach(h => {
            this.scene.remove(h);
            h.geometry.dispose();
            h.material.dispose();
        });
        this.vertexHelpers = [];
        
        this.points = [];
    }
    
    _finishPolygon() {
        if (this.points.length < 3) return;
        
        if (THREE.ShapeUtils.isClockWise(this.points)) {
            this.points.reverse();
        }
        
        const height = this.defaultHeight;
        
        // Создаём сразу 3D здание
        const shape = new THREE.Shape(this.points);
        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: height,
            bevelEnabled: false
        });
        
        const material = new THREE.MeshLambertMaterial({
            color: 0x5b8dd9,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        
        mesh.userData = {
            id: `new-${Date.now()}`,
            type: 'building',
            properties: {
                height: height,
                levels: Math.round(height / 3),
                isResidential: true,
                buildingType: 'apartments',
                heightSource: 'new',
                name: null,
                address: null
            },
            originalColor: 0x5b8dd9,
            basePoints: this.points.map(p => ({ x: p.x, y: p.y }))
        };
        
        this.buildingsGroup.add(mesh);
        
        this._clearPreview();
        
        this.onCreate(mesh);
        
        console.log(`[DrawTool] Создано здание: ${mesh.userData.id}`);
    }
}

export { DrawTool };
window.DrawTool = DrawTool;