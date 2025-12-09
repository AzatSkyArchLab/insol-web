/**
 * ============================================
 * SelectTool.js
 * Выбор зданий кликом
 * ============================================
 */

class SelectTool {
    constructor(sceneManager, options = {}) {
        this.sceneManager = sceneManager;
        this.camera = sceneManager.camera;
        this.renderer = sceneManager.renderer;
        this.buildingsGroup = sceneManager.getBuildingsGroup();
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Состояние
        this.selectedMesh = null;
        this.hoveredMesh = null;
        this.enabled = true;
        
        // Цвета
        this.selectedColor = 0xff6b6b;
        this.hoverColor = 0xffaa00;
        
        // Callbacks
        this.onSelect = options.onSelect || (() => {});
        this.onHover = options.onHover || (() => {});
        
        this._boundOnClick = this._onClick.bind(this);
        this._boundOnMouseMove = this._onMouseMove.bind(this);
        
        this._init();
        
        console.log('[SelectTool] Создан');
    }
    
    _init() {
        this.renderer.domElement.addEventListener('click', this._boundOnClick);
        this.renderer.domElement.addEventListener('mousemove', this._boundOnMouseMove);
    }
    
    _getMousePosition(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    
    _raycast() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Получаем все дочерние объекты группы зданий
        const buildings = this.buildingsGroup.children.filter(child => {
            return child.visible && child.userData.type === 'building';
        });
        
        if (buildings.length === 0) {
            return null;
        }
        
        const intersects = this.raycaster.intersectObjects(buildings, false);
        
        if (intersects.length > 0) {
            return intersects[0].object;
        }
        
        return null;
    }
    
    _onClick(event) {
        if (!this.enabled) return;
        if (event.button !== 0) return; // Только левый клик
        
        this._getMousePosition(event);
        const mesh = this._raycast();
        
        console.log('[SelectTool] Клик, найдено:', mesh ? mesh.userData.id : 'ничего');
        
        // Снимаем выделение с предыдущего
        if (this.selectedMesh && this.selectedMesh !== mesh) {
            this._restoreColor(this.selectedMesh);
        }
        
        if (mesh) {
            // Сохраняем оригинальный цвет если ещё не сохранён
            if (mesh.userData.originalColor === undefined) {
                mesh.userData.originalColor = mesh.material.color.getHex();
            }
            
            this.selectedMesh = mesh;
            mesh.material.color.setHex(this.selectedColor);
            
            console.log('[SelectTool] Выбрано:', mesh.userData.id);
            this.onSelect(mesh.userData, mesh);
        } else {
            // Клик в пустоту
            this.selectedMesh = null;
            this.onSelect(null, null);
        }
    }
    
    _onMouseMove(event) {
        if (!this.enabled) return;
        
        this._getMousePosition(event);
        const mesh = this._raycast();
        
        // Убираем hover с предыдущего
        if (this.hoveredMesh && this.hoveredMesh !== mesh && this.hoveredMesh !== this.selectedMesh) {
            this._restoreColor(this.hoveredMesh);
        }
        
        // Устанавливаем hover на новый
        if (mesh && mesh !== this.selectedMesh) {
            if (mesh.userData.originalColor === undefined) {
                mesh.userData.originalColor = mesh.material.color.getHex();
            }
            
            this.hoveredMesh = mesh;
            mesh.material.color.setHex(this.hoverColor);
            this.renderer.domElement.style.cursor = 'pointer';
            
            this.onHover(mesh.userData, mesh);
        } else if (!mesh) {
            this.hoveredMesh = null;
            this.renderer.domElement.style.cursor = 'default';
            this.onHover(null, null);
        }
    }
    
    _restoreColor(mesh) {
        if (!mesh || !mesh.material) return;
        
        const originalColor = mesh.userData.originalColor;
        if (originalColor !== undefined) {
            mesh.material.color.setHex(originalColor);
        }
    }
    
    /**
     * Снять выделение
     */
    deselect() {
        if (this.selectedMesh) {
            this._restoreColor(this.selectedMesh);
            this.selectedMesh = null;
        }
        if (this.hoveredMesh) {
            this._restoreColor(this.hoveredMesh);
            this.hoveredMesh = null;
        }
    }
    
    /**
     * Получить выбранное здание
     */
    getSelected() {
        return this.selectedMesh;
    }
    
    /**
     * Включить/выключить
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.deselect();
            this.renderer.domElement.style.cursor = 'default';
        }
    }
    
    /**
     * Выбрать конкретный mesh программно
     */
    select(mesh) {
        if (this.selectedMesh) {
            this._restoreColor(this.selectedMesh);
        }
        
        if (mesh) {
            if (mesh.userData.originalColor === undefined) {
                mesh.userData.originalColor = mesh.material.color.getHex();
            }
            
            this.selectedMesh = mesh;
            mesh.material.color.setHex(this.selectedColor);
            this.onSelect(mesh.userData, mesh);
        }
    }
    
    /**
     * Обновить группу зданий (после перезагрузки)
     */
    updateBuildingsGroup() {
        this.buildingsGroup = this.sceneManager.getBuildingsGroup();
        this.deselect();
    }
    
    /**
     * Уничтожить
     */
    dispose() {
        this.renderer.domElement.removeEventListener('click', this._boundOnClick);
        this.renderer.domElement.removeEventListener('mousemove', this._boundOnMouseMove);
        this.deselect();
    }
}

export { SelectTool };
window.SelectTool = SelectTool;