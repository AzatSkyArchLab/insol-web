/**
 * ============================================
 * MoveTool.js
 * Перемещение зданий
 * ============================================
 */

class MoveTool {
    constructor(sceneManager, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        this.camera = sceneManager.camera;
        this.renderer = sceneManager.renderer;
        this.controls = sceneManager.controls;
        this.buildingsGroup = sceneManager.getBuildingsGroup();
        
        this.enabled = false;
        this.selectedMesh = null;
        this.isDragging = false;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        this.dragStart = new THREE.Vector3();
        this.meshStartPos = new THREE.Vector3();
        
        // Подсветка
        this.highlightColor = 0xffaa00;
        this.originalColors = new Map();
        
        this.onChange = options.onChange || (() => {});
        
        this._boundOnMouseDown = this._onMouseDown.bind(this);
        this._boundOnMouseMove = this._onMouseMove.bind(this);
        this._boundOnMouseUp = this._onMouseUp.bind(this);
        
        console.log('[MoveTool] Создан');
    }
    
    enable() {
        this.enabled = true;
        this.renderer.domElement.addEventListener('mousedown', this._boundOnMouseDown);
        this.renderer.domElement.addEventListener('mousemove', this._boundOnMouseMove);
        this.renderer.domElement.addEventListener('mouseup', this._boundOnMouseUp);
        this.renderer.domElement.style.cursor = 'move';
        console.log('[MoveTool] Включен');
    }
    
    disable() {
        this.enabled = false;
        this.renderer.domElement.removeEventListener('mousedown', this._boundOnMouseDown);
        this.renderer.domElement.removeEventListener('mousemove', this._boundOnMouseMove);
        this.renderer.domElement.removeEventListener('mouseup', this._boundOnMouseUp);
        this.renderer.domElement.style.cursor = 'default';
        this._restoreColor();
        this.selectedMesh = null;
        this.isDragging = false;
        console.log('[MoveTool] Выключен');
    }
    
    _getMousePosition(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    
    _raycastBuildings() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.buildingsGroup.children, false);
        return intersects.length > 0 ? intersects[0] : null;
    }
    
    _highlightMesh(mesh) {
        if (!mesh) return;
        
        if (!this.originalColors.has(mesh.uuid)) {
            this.originalColors.set(mesh.uuid, mesh.material.color.getHex());
        }
        mesh.material.color.setHex(this.highlightColor);
    }
    
    _restoreColor() {
        if (this.selectedMesh && this.originalColors.has(this.selectedMesh.uuid)) {
            this.selectedMesh.material.color.setHex(this.originalColors.get(this.selectedMesh.uuid));
        }
    }
    
    _onMouseDown(event) {
        if (event.button !== 0) return;
        
        this._getMousePosition(event);
        const intersect = this._raycastBuildings();
        
        if (intersect) {
            this._restoreColor();
            this.selectedMesh = intersect.object;
            this._highlightMesh(this.selectedMesh);
            
            this.isDragging = true;
            this.controls.enabled = false;
            
            // Получаем точку на плоскости Z=0
            this.raycaster.ray.intersectPlane(this.groundPlane, this.dragStart);
            this.meshStartPos.copy(this.selectedMesh.position);
            
            this.renderer.domElement.style.cursor = 'grabbing';
            
            event.preventDefault();
            event.stopPropagation();
        }
    }
    
    _onMouseMove(event) {
        this._getMousePosition(event);
        
        if (this.isDragging && this.selectedMesh) {
            this.raycaster.setFromCamera(this.mouse, this.camera);
            
            const currentPoint = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(this.groundPlane, currentPoint);
            
            const deltaX = currentPoint.x - this.dragStart.x;
            const deltaY = currentPoint.y - this.dragStart.y;
            
            this.selectedMesh.position.x = this.meshStartPos.x + deltaX;
            this.selectedMesh.position.y = this.meshStartPos.y + deltaY;
            
        } else {
            // Hover эффект
            const intersect = this._raycastBuildings();
            if (intersect) {
                this.renderer.domElement.style.cursor = 'grab';
            } else {
                this.renderer.domElement.style.cursor = 'move';
            }
        }
    }
    
    _onMouseUp(event) {
        if (this.isDragging && this.selectedMesh) {
            this.isDragging = false;
            this.controls.enabled = true;
            this.renderer.domElement.style.cursor = 'grab';
            
            // Обновляем basePoints если есть
            if (this.selectedMesh.userData.basePoints) {
                const deltaX = this.selectedMesh.position.x - this.meshStartPos.x;
                const deltaY = this.selectedMesh.position.y - this.meshStartPos.y;
                
                this.selectedMesh.userData.basePoints = this.selectedMesh.userData.basePoints.map(p => ({
                    x: p.x + deltaX,
                    y: p.y + deltaY
                }));
            }
            
            this.onChange(this.selectedMesh);
            
            this._restoreColor();
            this.selectedMesh = null;
        }
    }
}

export { MoveTool };
window.MoveTool = MoveTool;