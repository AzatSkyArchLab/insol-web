/**
 * ============================================
 * SceneManager.js
 * Автономная 3D-сцена
 * ============================================
 */

class SceneManager {
    constructor(containerId, coordinates) {
        this.container = document.getElementById(containerId);
        this.coordinates = coordinates;
        
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        
        this.buildings = new THREE.Group();
        this.ground = new THREE.Group();
        this.helpers = new THREE.Group();
        
        this.areaSize = { width: 500, height: 500 };
        
        console.log('[SceneManager] Создан');
    }
    
    init() {
        this._createRenderer();
        this._createScene();
        this._createCamera();
        this._createControls();
        this._setupLights();
        this._setupHelpers();
        
        window.addEventListener('resize', () => this._onResize());
        
        this._animate();
        
        console.log('[SceneManager] Инициализирован');
        return this;
    }
    
    _createRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0xe8e8e8);
        
        this.container.innerHTML = '';
        this.container.appendChild(this.renderer.domElement);
    }
    
    _createScene() {
        this.scene = new THREE.Scene();
        this.scene.add(this.buildings);
        this.scene.add(this.ground);
        this.scene.add(this.helpers);
    }
    
    _createCamera() {
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 1, 5000);
        this.camera.position.set(200, -200, 300);
        this.camera.up.set(0, 0, 1);
    }
    
    _createControls() {
        // OrbitControls — вращение, зум, перемещение
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        
        this.controls.target.set(0, 0, 0);
        
        this.controls.minDistance = 50;
        this.controls.maxDistance = 1500;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Чуть выше горизонта
        
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
        };
        
        this.controls.update();
        console.log('[SceneManager] OrbitControls настроен');
    }
    
    _setupLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);
        
        const sun = new THREE.DirectionalLight(0xffffff, 0.8);
        sun.position.set(100, -100, 300);
        this.scene.add(sun);
        
        const sun2 = new THREE.DirectionalLight(0xffffff, 0.3);
        sun2.position.set(-100, 100, 200);
        this.scene.add(sun2);
    }
    
    _setupHelpers() {
        // Сетка
        const grid = new THREE.GridHelper(500, 50, 0x999999, 0xcccccc);
        grid.rotation.x = Math.PI / 2;
        this.helpers.add(grid);
        
        // Оси
        const axes = new THREE.AxesHelper(50);
        this.helpers.add(axes);
    }
    
    _onResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    _animate() {
        requestAnimationFrame(() => this._animate());
        
        this.controls.update();
        
        // Обновление HeightEditor
        if (window.heightEditor) {
            window.heightEditor.update();
        }
        
        this.renderer.render(this.scene, this.camera);
    }
    
    /**
     * Установить размер области и создать подложку
     */
    setAreaSize(width, height) {
        this.areaSize = { width, height };
        
        // Создаём плоскость-подложку
        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0xdddddd,
            side: THREE.DoubleSide
        });
        const plane = new THREE.Mesh(geometry, material);
        plane.position.set(0, 0, -0.5);
        
        this.ground.add(plane);
        
        // Обновляем сетку
        this.helpers.clear();
        const gridSize = Math.max(width, height);
        const grid = new THREE.GridHelper(gridSize, Math.floor(gridSize / 10), 0x999999, 0xcccccc);
        grid.rotation.x = Math.PI / 2;
        this.helpers.add(grid);
    }
    
    /**
     * Загрузить OSM тайл как подложку
     */
/**
 * Загрузить OSM тайлы как подложку
 */
    async loadGroundTile(bounds) {
        const centerLat = (bounds.south + bounds.north) / 2;
        const centerLon = (bounds.west + bounds.east) / 2;
        
        // Используем Static Maps API для точного покрытия
        // Вычисляем размер области
        const width = this.areaSize.width;
        const height = this.areaSize.height;
        
        // Zoom зависит от размера области
        let zoom = 17;
        if (width > 400 || height > 400) zoom = 16;
        if (width > 300 || height > 300) zoom = 16;
        if (width > 200 || height > 200) zoom = 17;
        if (width < 150 && height < 150) zoom = 18;
        
        // Собираем несколько тайлов для покрытия области
        const tiles = this._getTilesForBounds(bounds, zoom);
        
        console.log(`[SceneManager] Загрузка ${tiles.length} тайлов, zoom=${zoom}`);
        
        // Создаём группу для тайлов
        while (this.ground.children.length > 0) {
            const child = this.ground.children[0];
            if (child.material && child.material.map) {
                child.material.map.dispose();
            }
            if (child.material) child.material.dispose();
            if (child.geometry) child.geometry.dispose();
            this.ground.remove(child);
        }
        
        // Создаём простую серую подложку как fallback
        const fallbackGeo = new THREE.PlaneGeometry(width * 1.2, height * 1.2);
        const fallbackMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
        const fallbackPlane = new THREE.Mesh(fallbackGeo, fallbackMat);
        fallbackPlane.position.set(0, 0, -1);
        this.ground.add(fallbackPlane);
        
        // Загружаем тайлы
        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous';
        
        for (const tile of tiles) {
            const tileUrl = `https://basemaps.cartocdn.com/light_all/${tile.z}/${tile.x}/${tile.y}.png`;
            
            loader.load(tileUrl, (texture) => {
                // Вычисляем размер и позицию тайла в метрах
                const tileSize = this._getTileSizeMeters(tile.z, centerLat);
                const tileCenter = this._getTileCenter(tile.x, tile.y, tile.z);
                
                const tilePosMeters = {
                    x: (tileCenter.lon - centerLon) * 111320 * Math.cos(centerLat * Math.PI / 180),
                    y: (tileCenter.lat - centerLat) * 111320
                };
                
                const geometry = new THREE.PlaneGeometry(tileSize, tileSize);
                const material = new THREE.MeshBasicMaterial({ 
                    map: texture,
                    transparent: true
                });
                
                const plane = new THREE.Mesh(geometry, material);
                plane.position.set(tilePosMeters.x, tilePosMeters.y, -0.5);
                
                this.ground.add(plane);
            });
        }
    }

    /**
     * Получить список тайлов для покрытия области
     */
    _getTilesForBounds(bounds, zoom) {
        const tiles = [];
        
        const minTile = this._latLonToTile(bounds.north, bounds.west, zoom);
        const maxTile = this._latLonToTile(bounds.south, bounds.east, zoom);
        
        for (let x = minTile.x; x <= maxTile.x; x++) {
            for (let y = minTile.y; y <= maxTile.y; y++) {
                tiles.push({ x, y, z: zoom });
            }
        }
        
        return tiles;
    }

    /**
     * Конвертация lat/lon в номер тайла
     */
    _latLonToTile(lat, lon, zoom) {
        const x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
        const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
        return { x, y };
    }

    /**
     * Получить центр тайла в координатах
     */
    _getTileCenter(x, y, zoom) {
        const n = Math.pow(2, zoom);
        const lon = (x + 0.5) / n * 360 - 180;
        const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n)));
        const lat = latRad * 180 / Math.PI;
        return { lat, lon };
    }

    /**
     * Размер тайла в метрах на данном zoom и широте
     */
    _getTileSizeMeters(zoom, lat) {
        const earthCircumference = 40075016.686;
        const tileSize = earthCircumference * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
        return tileSize;
    }
    
    getBuildingsGroup() {
        return this.buildings;
    }
    
    clearBuildings() {
        while (this.buildings.children.length > 0) {
            const mesh = this.buildings.children[0];
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
            this.buildings.remove(mesh);
        }
    }
    
    toggleHelpers(visible) {
        this.helpers.visible = visible;
    }
}

export { SceneManager };
window.SceneManager = SceneManager;