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
        
        // Цвета
        this.selectedColor = 0xff6b6b;
        this.hoverColor = 0xffaa00;
        
        // Callbacks
        this.onSelect = options.onSelect || (() => {});
        this.onHover = options.onHover || (() => {});
        
        // Сохраняем оригинальные цвета всех зданий
        this._saveAllOriginalColors();
        
        this._init();
        console.log('[SelectTool] Создан');
    }
    
    _saveAllOriginalColors() {
        for (const mesh of this.buildingsGroup.children) {
            if (mesh.material && !mesh.userData.originalColor) {
                mesh.userData.originalColor = mesh.material.color.getHex();
            }
        }
    }
    
    _init() {
        const canvas = this.renderer.domElement;
        
        canvas.addEventListener('click', (e) => this._onClick(e));
        canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    }
    
    _getMousePosition(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    
    _raycast() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.buildingsGroup.children, false);
        
        if (intersects.length > 0) {
            return intersects[0].object;
        }
        return null;
    }
    
    _onClick(event) {
        this._getMousePosition(event);
        const mesh = this._raycast();
        
        // Снимаем выделение с предыдущего
        if (this.selectedMesh && this.selectedMesh !== mesh) {
            this._restoreColor(this.selectedMesh);
        }
        
        if (mesh) {
            this.selectedMesh = mesh;
            mesh.material.color.setHex(this.selectedColor);
            this.onSelect(mesh.userData, mesh);
        } else {
            // Клик в пустоту — снимаем выделение
            if (this.selectedMesh) {
                this._restoreColor(this.selectedMesh);
                this.selectedMesh = null;
            }
            this.onSelect(null, null);
        }
    }
    
    _onMouseMove(event) {
        this._getMousePosition(event);
        const mesh = this._raycast();
        
        // Убираем hover с предыдущего (если это не selected)
        if (this.hoveredMesh && this.hoveredMesh !== mesh) {
            if (this.hoveredMesh !== this.selectedMesh) {
                this._restoreColor(this.hoveredMesh);
            }
            this.hoveredMesh = null;
        }
        
        // Устанавливаем hover на новый (если это не selected)
        if (mesh && mesh !== this.selectedMesh && mesh !== this.hoveredMesh) {
            this.hoveredMesh = mesh;
            mesh.material.color.setHex(this.hoverColor);
            this.renderer.domElement.style.cursor = 'pointer';
            this.onHover(mesh.userData, mesh);
        } else if (!mesh) {
            this.renderer.domElement.style.cursor = 'default';
            this.onHover(null, null);
        }
    }
    
    _restoreColor(mesh) {
        if (mesh && mesh.userData.originalColor !== undefined) {
            mesh.material.color.setHex(mesh.userData.originalColor);
        }
    }
    
    /**
     * Снять выделение (без вызова callback — избегаем рекурсии)
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
        // НЕ вызываем onSelect — это делает вызывающий код
    }
    
    /**
     * Обновить оригинальные цвета
     */
    refresh() {
        this.selectedMesh = null;
        this.hoveredMesh = null;
        this._saveAllOriginalColors();
    }
    
    getSelected() {
        return this.selectedMesh;
    }
}

export { SelectTool };
window.SelectTool = SelectTool;