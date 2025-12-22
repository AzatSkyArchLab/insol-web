/**
 * ============================================
 * Underlay.js
 * Класс одной DXF-подложки
 * ============================================
 */

class Underlay {
    /**
     * @param {string} id - уникальный идентификатор
     * @param {string} name - имя файла
     * @param {Object} data - распарсенные данные { lines, bounds, layers }
     */
    constructor(id, name, data) {
        this.id = id;
        this.name = name;
        this.data = data;
        
        // Трансформации
        this.position = { x: 0, y: 0 };
        this.rotation = 0;  // радианы
        this.elevation = 0; // высота Z в метрах
        
        // Состояние
        this.visible = true;
        this.selected = false;
        
        // Three.js объекты
        this.mesh = null;
        this.color = 0x000000;  // чистый чёрный для контраста
        
        // Исходные bounds (до трансформаций)
        this.originalBounds = { ...data.bounds };
        
        console.log(`[Underlay] Создан: ${name}, линий: ${data.lines.length}`);
    }
    
    /**
     * Создание Three.js меша
     * @returns {THREE.Group}
     */
    createMesh() {
        const group = new THREE.Group();
        group.userData = {
            type: 'underlay',
            id: this.id,
            name: this.name
        };
        
        // Материал для линий - чистый чёрный, толще для видимости
        const material = new THREE.LineBasicMaterial({
            color: this.color,
            linewidth: 2
        });
        
        // Центр подложки для вращения вокруг собственного центра
        const cx = this.originalBounds.centerX;
        const cy = this.originalBounds.centerY;
        
        // Создаём линии, сдвигая их так чтобы центр был в (0,0)
        for (const line of this.data.lines) {
            const geometry = this._createLineGeometry(line.points, cx, cy);
            const lineObj = new THREE.Line(geometry, material.clone());
            lineObj.userData = {
                layer: line.layer,
                type: line.type
            };
            group.add(lineObj);
        }
        
        // Невидимый bounding box для raycast (чтобы можно было кликать)
        const bounds = this.originalBounds;
        const boxGeometry = new THREE.PlaneGeometry(bounds.width, bounds.height);
        const boxMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0,  // Невидимый, но raycast работает
            side: THREE.DoubleSide,
            depthWrite: false  // Не записывает в depth buffer — не перекрывает здания
        });
        const hitBox = new THREE.Mesh(boxGeometry, boxMaterial);
        hitBox.userData = { 
            type: 'underlay-hitbox',
            underlayId: this.id 
        };
        hitBox.position.z = 0.01; // Чуть выше линий
        group.add(hitBox);
        this.hitBox = hitBox;
        
        // Позиционируем группу — добавляем смещение центра
        group.position.set(
            this.position.x + cx, 
            this.position.y + cy, 
            this.elevation
        );
        group.rotation.z = this.rotation;
        
        this.mesh = group;
        return group;
    }
    
    /**
     * Создание геометрии линии
     * @param {Array} points - точки линии
     * @param {number} cx - смещение центра X
     * @param {number} cy - смещение центра Y
     */
    _createLineGeometry(points, cx = 0, cy = 0) {
        const vertices = [];
        
        for (const p of points) {
            // Сдвигаем точки так, чтобы центр подложки был в (0,0)
            vertices.push(p.x - cx, p.y - cy, 0);
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', 
            new THREE.Float32BufferAttribute(vertices, 3)
        );
        
        return geometry;
    }
    
    /**
     * Обновление позиции
     * @param {number} x
     * @param {number} y
     */
    setPosition(x, y) {
        this.position.x = x;
        this.position.y = y;
        
        if (this.mesh) {
            // Учитываем что геометрия центрирована
            const cx = this.originalBounds.centerX;
            const cy = this.originalBounds.centerY;
            this.mesh.position.x = x + cx;
            this.mesh.position.y = y + cy;
        }
    }
    
    /**
     * Обновление поворота
     * @param {number} radians
     */
    setRotation(radians) {
        this.rotation = radians;
        
        if (this.mesh) {
            this.mesh.rotation.z = radians;
        }
    }
    
    /**
     * Обновление высоты
     * @param {number} z - высота в метрах
     */
    setElevation(z) {
        this.elevation = z;
        
        if (this.mesh) {
            this.mesh.position.z = z;
        }
    }
    
    /**
     * Изменение высоты на delta
     * @param {number} delta - изменение в метрах
     */
    adjustElevation(delta) {
        this.setElevation(this.elevation + delta);
    }
    
    /**
     * Показать/скрыть
     * @param {boolean} visible
     */
    setVisible(visible) {
        this.visible = visible;
        
        if (this.mesh) {
            this.mesh.visible = visible;
        }
    }
    
    /**
     * Выделение
     * @param {boolean} selected
     * @param {boolean} isMultiSelect - множественный выбор (фиолетовый)
     */
    setSelected(selected, isMultiSelect = false) {
        this.selected = selected;
        
        if (this.mesh) {
            let color = this.color; // Чёрный по умолчанию
            if (selected) {
                color = isMultiSelect ? 0x9b59b6 : 0x0066ff; // Фиолетовый или синий
            }
            
            this.mesh.traverse(child => {
                if (child.material && child.userData?.type !== 'underlay-hitbox') {
                    child.material.color.setHex(color);
                }
            });
        }
    }
    
    /**
     * Подсветка при hover
     */
    setHovered(hovered) {
        if (!this.selected && this.mesh) {
            const color = hovered ? 0x3498db : this.color;
            this.mesh.traverse(child => {
                if (child.material && child.userData?.type !== 'underlay-hitbox') {
                    child.material.color.setHex(color);
                }
            });
        }
    }
    
    /**
     * Получить текущий bounding box (с учётом трансформаций)
     * @returns {Object}
     */
    getBounds() {
        const ob = this.originalBounds;
        const cos = Math.cos(this.rotation);
        const sin = Math.sin(this.rotation);
        
        // Углы оригинального bbox
        const corners = [
            { x: ob.minX, y: ob.minY },
            { x: ob.maxX, y: ob.minY },
            { x: ob.maxX, y: ob.maxY },
            { x: ob.minX, y: ob.maxY }
        ];
        
        // Трансформируем углы
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (const c of corners) {
            // Rotate around original center
            const cx = c.x - ob.centerX;
            const cy = c.y - ob.centerY;
            const rx = cx * cos - cy * sin + ob.centerX;
            const ry = cx * sin + cy * cos + ob.centerY;
            
            // Translate
            const x = rx + this.position.x;
            const y = ry + this.position.y;
            
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
        
        return {
            minX, maxX, minY, maxY,
            width: maxX - minX,
            height: maxY - minY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }
    
    /**
     * Получить центр подложки в мировых координатах
     */
    getWorldCenter() {
        const bounds = this.getBounds();
        return {
            x: bounds.centerX,
            y: bounds.centerY,
            z: this.elevation
        };
    }
    
    /**
     * Сериализация для сохранения в проект
     */
    serialize() {
        return {
            id: this.id,
            name: this.name,
            position: { ...this.position },
            rotation: this.rotation,
            elevation: this.elevation,
            visible: this.visible,
            lines: this.data.lines,
            bounds: this.originalBounds,
            layers: this.data.layers
        };
    }
    
    /**
     * Десериализация
     * @param {Object} data
     * @returns {Underlay}
     */
    static deserialize(data) {
        const underlayData = {
            lines: data.lines,
            bounds: data.bounds,
            layers: data.layers || []
        };
        
        const underlay = new Underlay(data.id, data.name, underlayData);
        underlay.position = { ...data.position };
        underlay.rotation = data.rotation;
        underlay.elevation = data.elevation;
        underlay.visible = data.visible !== false;
        
        return underlay;
    }
    
    /**
     * Очистка ресурсов
     */
    dispose() {
        if (this.mesh) {
            this.mesh.traverse(child => {
                if (child.geometry) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    child.material.dispose();
                }
            });
            this.mesh = null;
        }
    }
}

export { Underlay };
