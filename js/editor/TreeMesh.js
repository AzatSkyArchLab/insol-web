/**
 * ============================================
 * TreeMesh.js
 * 3D модели деревьев для CFD анализа
 * 
 * Три типа по плотности листвы (LAD - Leaf Area Density):
 * - dense:  LAD = 2.0 м²/м³ (лето, густая крона) → снижение ~50-60%
 * - medium: LAD = 1.0 м²/м³ (стандартное дерево) → снижение ~30-40%
 * - sparse: LAD = 0.4 м²/м³ (зима, голые ветки) → снижение ~10-20%
 * 
 * Физика: Forchheimer model f = LAD × Cd
 * При Cd = 0.2 (типичное значение для листвы):
 * - dense:  f = 0.4
 * - medium: f = 0.2
 * - sparse: f = 0.08
 * ============================================
 */

class TreeMesh {
    constructor() {
        // Параметры по типам деревьев
        // LAD значения основаны на литературе (Krayenhoff et al., 2020)
        this.treeTypes = {
            dense: {
                name: 'Густая крона',
                lad: 4.0,  // м²/м³ - густая летняя листва
                color: 0x2d5a27,
                opacity: 0.85,
                description: 'Летнее дерево с полной листвой (снижение ~50-60%)'
            },
            medium: {
                name: 'Средняя крона',
                lad: 2.0,  // м²/м³ - типичное городское дерево
                color: 0x4a7c43,
                opacity: 0.7,
                description: 'Типичное городское дерево (снижение ~30-40%)'
            },
            sparse: {
                name: 'Редкая крона',
                lad: 1.0,  // м²/м³ - зима или молодое дерево
                color: 0x8b7355,
                opacity: 0.4,
                description: 'Зимнее дерево или молодое (снижение ~10-20%)'
            }
        };
        
        // Параметры по умолчанию
        this.defaults = {
            crownRadius: 3,
            crownHeight: 5,
            trunkHeight: 2.5,
            trunkRadius: 0.25
        };
        
        // Материал ствола
        this.trunkMaterial = new THREE.MeshLambertMaterial({
            color: 0x4a3728,
            side: THREE.DoubleSide
        });
        
        console.log('[TreeMesh] Инициализирован');
    }
    
    _createCrownMaterial(treeType) {
        const config = this.treeTypes[treeType] || this.treeTypes.medium;
        return new THREE.MeshLambertMaterial({
            color: config.color,
            transparent: true,
            opacity: config.opacity,
            side: THREE.DoubleSide
        });
    }
    
    _createCrownGeometry(crownRadius, crownHeight) {
        const geometry = new THREE.SphereGeometry(1, 16, 16);
        geometry.scale(crownRadius, crownRadius, crownHeight / 2);
        return geometry;
    }
    
    _createTrunkGeometry(trunkRadius, trunkHeight) {
        return new THREE.CylinderGeometry(
            trunkRadius * 0.7,
            trunkRadius,
            trunkHeight,
            8
        );
    }
    
    createTree(options = {}) {
        const {
            treeType = 'medium',
            crownRadius = this.defaults.crownRadius,
            crownHeight = this.defaults.crownHeight,
            trunkHeight = this.defaults.trunkHeight,
            trunkRadius = this.defaults.trunkRadius,
            position = { x: 0, y: 0 }
        } = options;
        
        const group = new THREE.Group();
        
        // Ствол
        const trunkGeometry = this._createTrunkGeometry(trunkRadius, trunkHeight);
        const trunk = new THREE.Mesh(trunkGeometry, this.trunkMaterial.clone());
        trunk.rotation.x = Math.PI / 2;
        trunk.position.z = trunkHeight / 2;
        group.add(trunk);
        
        // Крона
        const crownGeometry = this._createCrownGeometry(crownRadius, crownHeight);
        const crownMaterial = this._createCrownMaterial(treeType);
        const crown = new THREE.Mesh(crownGeometry, crownMaterial);
        crown.position.z = trunkHeight + crownHeight / 2;
        group.add(crown);
        
        // Позиция
        group.position.set(position.x, position.y, 0);
        
        // Метаданные для CFD
        const typeConfig = this.treeTypes[treeType];
        group.userData = {
            id: `tree_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            type: 'tree',
            treeType: treeType,
            lad: typeConfig.lad,
            properties: {
                crownRadius,
                crownHeight,
                trunkHeight,
                trunkRadius,
                totalHeight: trunkHeight + crownHeight,
                lad: typeConfig.lad,
                cd: 0.2  // Drag coefficient для листвы
            },
            crownBounds: {
                center: { x: position.x, y: position.y, z: trunkHeight + crownHeight / 2 },
                radius: crownRadius,
                height: crownHeight
            }
        };
        
        return group;
    }
    
    createPreview(options = {}) {
        const tree = this.createTree(options);
        tree.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                child.material.opacity = 0.5;
                child.material.transparent = true;
            }
        });
        tree.userData.isPreview = true;
        return tree;
    }
    
    updateTree(treeGroup, options = {}) {
        const { treeType, crownRadius, crownHeight, trunkHeight } = options;
        
        let crown = null;
        let trunk = null;
        
        treeGroup.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry.type === 'SphereGeometry') {
                    crown = child;
                } else if (child.geometry.type === 'CylinderGeometry') {
                    trunk = child;
                }
            }
        });
        
        if (treeType && crown) {
            const config = this.treeTypes[treeType];
            crown.material.color.setHex(config.color);
            crown.material.opacity = treeGroup.userData.isPreview ? 0.5 : config.opacity;
            treeGroup.userData.treeType = treeType;
            treeGroup.userData.lad = config.lad;
            treeGroup.userData.properties.lad = config.lad;
        }
        
        if (crownRadius !== undefined && crownHeight !== undefined && crown) {
            crown.geometry.dispose();
            crown.geometry = this._createCrownGeometry(crownRadius, crownHeight);
            const newTrunkHeight = trunkHeight !== undefined ? trunkHeight : treeGroup.userData.properties.trunkHeight;
            crown.position.z = newTrunkHeight + crownHeight / 2;
            treeGroup.userData.properties.crownRadius = crownRadius;
            treeGroup.userData.properties.crownHeight = crownHeight;
            treeGroup.userData.crownBounds.radius = crownRadius;
            treeGroup.userData.crownBounds.height = crownHeight;
        }
        
        if (trunkHeight !== undefined && trunk) {
            trunk.geometry.dispose();
            trunk.geometry = this._createTrunkGeometry(
                treeGroup.userData.properties.trunkRadius,
                trunkHeight
            );
            trunk.position.z = trunkHeight / 2;
            if (crown) {
                const ch = treeGroup.userData.properties.crownHeight;
                crown.position.z = trunkHeight + ch / 2;
            }
            treeGroup.userData.properties.trunkHeight = trunkHeight;
            treeGroup.userData.properties.totalHeight = trunkHeight + treeGroup.userData.properties.crownHeight;
        }
    }
    
    highlight(treeGroup) {
        treeGroup.traverse((child) => {
            if (child.isMesh) {
                child.material.emissive = new THREE.Color(0x444444);
            }
        });
    }
    
    unhighlight(treeGroup) {
        treeGroup.traverse((child) => {
            if (child.isMesh) {
                child.material.emissive = new THREE.Color(0x000000);
            }
        });
    }
    
    getTreeDataForCFD(treeGroup) {
        const ud = treeGroup.userData;
        const pos = treeGroup.position;
        return {
            id: ud.id,
            type: ud.treeType,
            position: { x: pos.x, y: pos.y },
            crown: {
                centerZ: ud.properties.trunkHeight + ud.properties.crownHeight / 2,
                radius: ud.properties.crownRadius,
                height: ud.properties.crownHeight
            },
            lad: ud.properties.lad,
            cd: ud.properties.cd
        };
    }
    
    getTreeTypes() {
        return Object.entries(this.treeTypes).map(([key, value]) => ({
            id: key,
            ...value
        }));
    }
}

export { TreeMesh };
window.TreeMesh = TreeMesh;