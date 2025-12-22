/**
 * ============================================
 * WindAnalysis.js
 * Визуализация результатов CFD на карте
 * ============================================
 */

class WindAnalysis {
    constructor(sceneManager, coords) {
        this.sceneManager = sceneManager;
        this.coords = coords;
        this.windData = null;
        this.overlay = null;
        this.visible = false;
        
        console.log('[WindAnalysis] Создан');
    }
    
    /**
     * Загрузить JSON с результатами CFD
     */
    loadWindField(jsonData) {
        if (typeof jsonData === 'string') {
            this.windData = JSON.parse(jsonData);
        } else {
            this.windData = jsonData;
        }
        console.log('[WindAnalysis] Загружено:', this.windData.grid.nx, 'x', this.windData.grid.ny);
        return this;
    }
    
    /**
     * Показать/скрыть overlay
     */
    toggle() {
        this.visible = !this.visible;
        if (this.visible) {
            this.render();
        } else {
            this.hide();
        }
        return this.visible;
    }
    
    /**
     * Отрисовать ветровое поле поверх сцены
     */
    render() {
        if (!this.windData) {
            console.warn('[WindAnalysis] Нет данных для отрисовки');
            return;
        }
        
        this.hide(); // Удаляем старый overlay
        
        const grid = this.windData.grid;
        const nx = grid.nx;
        const ny = grid.ny;
        const spacing = grid.spacing;
        const origin = grid.origin;
        
        // Создаём canvas texture
        const canvas = document.createElement('canvas');
        canvas.width = nx;
        canvas.height = ny;
        const ctx = canvas.getContext('2d');
        
        // Рисуем пиксели
        const imageData = ctx.createImageData(nx, ny);
        
        for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
                const amp = grid.values[iy][ix];
                const color = this._ampToRGB(amp);
                
                // Переворачиваем Y для правильной ориентации
                const pixelIndex = ((ny - 1 - iy) * nx + ix) * 4;
                imageData.data[pixelIndex] = color.r;
                imageData.data[pixelIndex + 1] = color.g;
                imageData.data[pixelIndex + 2] = color.b;
                imageData.data[pixelIndex + 3] = amp < 0.01 ? 0 : 180; // Прозрачность для зданий
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
        
        // Создаём Three.js текстуру и плоскость
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        
        const width = nx * spacing;
        const height = ny * spacing;
        
        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        
        this.overlay = new THREE.Mesh(geometry, material);
        
        // Позиционируем
        const centerX = origin[0] + width / 2;
        const centerY = origin[1] + height / 2;
        this.overlay.position.set(centerX, centerY, 2); // z=2 чуть выше земли
        
        this.sceneManager.scene.add(this.overlay);
        this.visible = true;
        
        console.log('[WindAnalysis] Overlay добавлен:', width, 'x', height, 'м');
    }
    
    hide() {
        if (this.overlay) {
            this.sceneManager.scene.remove(this.overlay);
            if (this.overlay.material.map) {
                this.overlay.material.map.dispose();
            }
            this.overlay.material.dispose();
            this.overlay.geometry.dispose();
            this.overlay = null;
        }
        this.visible = false;
    }
    
    /**
     * Цвет по коэффициенту усиления (Lawson criterion)
     */
    _ampToRGB(amp) {
        if (amp < 0.01) return { r: 51, g: 51, b: 51 };      // Building - серый
        if (amp < 0.5) return { r: 50, g: 136, b: 189 };     // Тихо - синий
        if (amp < 0.8) return { r: 153, g: 213, b: 148 };    // Комфортно - зелёный
        if (amp < 1.0) return { r: 254, g: 224, b: 139 };    // Умеренно - жёлтый
        if (amp < 1.2) return { r: 252, g: 141, b: 89 };     // Ветрено - оранжевый
        return { r: 213, g: 62, b: 79 };                      // Опасно - красный
    }
    
    /**
     * Экспорт зданий для CFD генератора
     */
    exportBuildingsForCFD() {
        const buildings = this.sceneManager.getBuildingsGroup();
        const features = [];
        
        buildings.children.forEach(mesh => {
            if (mesh.userData?.type !== 'building') return;
            
            const height = mesh.userData.properties?.height || 9;
            const bbox = new THREE.Box3().setFromObject(mesh);
            
            features.push({
                type: 'Feature',
                properties: {
                    height: height,
                    id: mesh.userData.id
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: [[
                        [bbox.min.x, bbox.min.y],
                        [bbox.max.x, bbox.min.y],
                        [bbox.max.x, bbox.max.y],
                        [bbox.min.x, bbox.max.y],
                        [bbox.min.x, bbox.min.y]
                    ]]
                }
            });
        });
        
        const geojson = {
            type: 'FeatureCollection',
            features: features
        };
        
        console.log('[WindAnalysis] Экспорт:', features.length, 'зданий');
        return geojson;
    }
}

export { WindAnalysis };
window.WindAnalysis = WindAnalysis;
