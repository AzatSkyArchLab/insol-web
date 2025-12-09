/**
 * ============================================
 * BuildingMesh.js
 * Создание 3D-мешей (THREE.Shape + ExtrudeGeometry)
 * ============================================
 */

class BuildingMesh {
    constructor(coordinates) {
        this.coordinates = coordinates;
        
        this.colors = {
            residential: 0x5b8dd9,
            other: 0x888888
        };
        
        console.log('[BuildingMesh] Создан');
    }
    
    _createMaterial(isResidential) {
        return new THREE.MeshLambertMaterial({
            color: isResidential ? this.colors.residential : this.colors.other,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide
        });
    }
    
    createMesh(building) {
        if (!building.coordinates || building.coordinates.length < 4) {
            return null;
        }
        
        const height = building.properties.height || 9;
        
        // Конвертируем внешний контур
        let outerPoints = this._coordsToVector2(building.coordinates);
        outerPoints = this._cleanRing(outerPoints);
        
        if (!outerPoints || outerPoints.length < 3) {
            return null;
        }
        
        // THREE.Shape требует CCW для outer
        if (THREE.ShapeUtils.isClockWise(outerPoints)) {
            outerPoints.reverse();
        }
        
        // Создаём Shape
        const shape = new THREE.Shape(outerPoints);
        
        // Добавляем дырки
        if (building.holes && building.holes.length > 0) {
            for (const holeCoords of building.holes) {
                let holePoints = this._coordsToVector2(holeCoords);
                holePoints = this._cleanRing(holePoints);
                
                if (holePoints && holePoints.length >= 3) {
                    // THREE.Shape требует CW для holes
                    if (!THREE.ShapeUtils.isClockWise(holePoints)) {
                        holePoints.reverse();
                    }
                    shape.holes.push(new THREE.Path(holePoints));
                }
            }
        }
        
        // Создаём геометрию
        let geometry;
        try {
            geometry = new THREE.ExtrudeGeometry(shape, {
                depth: height,
                bevelEnabled: false
            });
        } catch (e) {
            return null;
        }
        
        // Проверка валидности
        const pos = geometry.getAttribute('position');
        if (!pos || pos.count < 3) {
            geometry.dispose();
            return null;
        }
        
        // Проверка на NaN
        for (let i = 0; i < Math.min(pos.count, 30); i++) {
            if (isNaN(pos.getX(i)) || isNaN(pos.getY(i)) || isNaN(pos.getZ(i))) {
                geometry.dispose();
                return null;
            }
        }
        
        const isResidential = building.properties.isResidential || false;
        const material = this._createMaterial(isResidential);
        const mesh = new THREE.Mesh(geometry, material);
        
        mesh.userData = {
            id: building.id,
            type: 'building',
            properties: building.properties,
            originalColor: material.color.getHex(),
            hasHoles: shape.holes.length > 0
        };
        
        return mesh;
    }
    
    _coordsToVector2(coords) {
        return coords.map(coord => {
            const meters = this.coordinates.wgs84ToMeters(coord[1], coord[0]);
            return new THREE.Vector2(meters.x, meters.y);
        });
    }
    
    _cleanRing(points) {
        if (!points || points.length < 3) return null;
        
        let result = points.slice();
        
        // Убираем замыкающую точку (GeoJSON кольца замкнуты)
        if (result.length > 1 && result[0].distanceTo(result[result.length - 1]) < 0.1) {
            result.pop();
        }
        
        // Убираем дубликаты подряд
        const cleaned = [result[0]];
        for (let i = 1; i < result.length; i++) {
            if (result[i].distanceTo(cleaned[cleaned.length - 1]) > 0.05) {
                cleaned.push(result[i]);
            }
        }
        result = cleaned;
        
        if (result.length < 3) return null;
        
        // Проверяем площадь
        const area = THREE.ShapeUtils.area(result);
        if (Math.abs(area) < 0.5) return null;
        
        return result;
    }
    
    createMeshes(buildings) {
        const meshes = [];
        let errors = 0;
        let withHoles = 0;
        
        for (const building of buildings) {
            const mesh = this.createMesh(building);
            if (mesh) {
                meshes.push(mesh);
                if (mesh.userData.hasHoles) withHoles++;
            } else {
                errors++;
            }
        }
        
        console.log(`[BuildingMesh] Создано: ${meshes.length}, с дырками: ${withHoles}, пропущено: ${errors}`);
        return meshes;
    }
    
    highlight(mesh) {
        if (mesh && mesh.material) {
            mesh.material.color.setHex(0xff6b6b);
        }
    }
    
    unhighlight(mesh) {
        if (mesh && mesh.material) {
            mesh.material.color.setHex(mesh.userData.originalColor || 0x4a90d9);
        }
    }
}

export { BuildingMesh };
window.BuildingMesh = BuildingMesh;