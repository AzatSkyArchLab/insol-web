/**
 * ============================================
 * BuildingMesh.js
 * Создание 3D-мешей зданий из полигонов
 * ============================================
 */

class BuildingMesh {
    /**
     * @param {Coordinates} coordinates - Система координат
     */
    constructor(coordinates) {
        this.coordinates = coordinates;
        
        // Материалы
        this.defaultMaterial = new THREE.MeshLambertMaterial({
            color: 0x4a90d9,
            transparent: true,
            opacity: 0.85
        });
        
        this.selectedMaterial = new THREE.MeshLambertMaterial({
            color: 0xff6b6b,
            transparent: true,
            opacity: 0.9
        });
        
        console.log('[BuildingMesh] Создан');
    }
    
    /**
     * Создать 3D-меш здания
     * @param {Object} building - Данные здания из BuildingLoader
     * @returns {THREE.Mesh|null}
     */
    createMesh(building) {
        if (!building.coordinates || building.coordinates.length < 3) {
            return null;
        }
        
        const height = building.properties.height || 10;
        
        // Конвертируем координаты WGS84 → локальные метры
        const points = building.coordinates.map(coord => {
            const meters = this.coordinates.wgs84ToMeters(coord[1], coord[0]); // [lon, lat] → (lat, lon)
            return new THREE.Vector2(meters.x, meters.y);
        });
        
        // Убираем последнюю точку если она дублирует первую (замкнутый полигон)
        if (points.length > 1) {
            const first = points[0];
            const last = points[points.length - 1];
            if (Math.abs(first.x - last.x) < 0.01 && Math.abs(first.y - last.y) < 0.01) {
                points.pop();
            }
        }
        
        if (points.length < 3) {
            return null;
        }
        
        // Создаём Shape (2D контур)
        const shape = new THREE.Shape(points);
        
        // Экструзия в 3D
        const extrudeSettings = {
            depth: height,
            bevelEnabled: false
        };
        
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        
        // Поворот чтобы высота была по Z (вверх)
        geometry.rotateX(-Math.PI / 2);
        geometry.rotateX(Math.PI);
        geometry.translate(0, 0, height);
        
        const mesh = new THREE.Mesh(geometry, this.defaultMaterial.clone());
        
        // Сохраняем данные в userData
        mesh.userData = {
            id: building.id,
            type: 'building',
            properties: building.properties,
            originalCoordinates: building.coordinates
        };
        
        return mesh;
    }
    
    /**
     * Создать меши для массива зданий
     * @param {Array} buildings
     * @returns {Array<THREE.Mesh>}
     */
    createMeshes(buildings) {
        const meshes = [];
        let errors = 0;
        
        for (const building of buildings) {
            try {
                const mesh = this.createMesh(building);
                if (mesh) {
                    meshes.push(mesh);
                }
            } catch (e) {
                errors++;
            }
        }
        
        if (errors > 0) {
            console.warn(`[BuildingMesh] Ошибок при создании мешей: ${errors}`);
        }
        
        console.log(`[BuildingMesh] Создано мешей: ${meshes.length}`);
        return meshes;
    }
    
    /**
     * Подсветить здание
     */
    highlight(mesh) {
        if (mesh && mesh.material) {
            mesh.material.color.setHex(0xff6b6b);
        }
    }
    
    /**
     * Сбросить подсветку
     */
    unhighlight(mesh) {
        if (mesh && mesh.material) {
            mesh.material.color.setHex(0x4a90d9);
        }
    }
}

export { BuildingMesh };
window.BuildingMesh = BuildingMesh;