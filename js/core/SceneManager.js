/**
 * ============================================
 * SceneManager.js
 * Управление Three.js сценой поверх карты
 * ============================================
 */

class SceneManager {
    /**
     * @param {string} canvasId - ID canvas элемента
     * @param {MapEngine} mapEngine - Ссылка на движок карты
     * @param {Coordinates} coordinates - Система координат
     */
    constructor(canvasId, mapEngine, coordinates) {
        this.canvas = document.getElementById(canvasId);
        this.mapEngine = mapEngine;
        this.coordinates = coordinates;
        
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        // Объекты сцены
        this.buildings = new THREE.Group();
        this.helpers = new THREE.Group();
        
        console.log('[SceneManager] Создан');
    }
    
    /**
     * Инициализация Three.js
     */
    init() {
        // Сцена
        this.scene = new THREE.Scene();
        
        // Камера (перспективная)
        const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10000);
        this.camera.position.set(0, -500, 400);
        this.camera.lookAt(0, 0, 0);
        
        // Рендерер
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true  // Прозрачный фон — видна карта под ним
        });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        
        // Группы объектов
        this.scene.add(this.buildings);
        this.scene.add(this.helpers);
        
        // Освещение
        this._setupLights();
        
        // Вспомогательные объекты
        this._setupHelpers();
        
        // События
        window.addEventListener('resize', () => this._onResize());
        
        // Синхронизация с картой
        this.mapEngine.getMap().on('move', () => this._syncWithMap());
        
        // Запуск рендер-цикла
        this._animate();
        
        console.log('[SceneManager] Инициализирован');
        return this;
    }
    
    /**
     * Настройка освещения
     */
    _setupLights() {
        // Ambient — общая подсветка
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        
        // Directional — имитация солнца
        const sun = new THREE.DirectionalLight(0xffffff, 0.8);
        sun.position.set(100, 100, 200);
        this.scene.add(sun);
    }
    
    /**
     * Вспомогательные объекты для отладки
     */
    _setupHelpers() {
        // Оси координат (X=красный, Y=зелёный, Z=синий)
        const axes = new THREE.AxesHelper(50);
        this.helpers.add(axes);
        
        // Сетка на земле
        const grid = new THREE.GridHelper(200, 20, 0x888888, 0xcccccc);
        grid.rotation.x = Math.PI / 2; // Поворот чтобы лежала в XY плоскости
        this.helpers.add(grid);
    }
    
    /**
     * Синхронизация камеры Three.js с картой MapLibre
     */
    _syncWithMap() {
        const map = this.mapEngine.getMap();
        
        // Получаем параметры камеры карты
        const center = map.getCenter();
        const zoom = map.getZoom();
        const pitch = map.getPitch();
        const bearing = map.getBearing();
        
        // Высота камеры зависит от зума
        // Эмпирическая формула: чем больше zoom, тем ниже камера
        const altitude = 50000 / Math.pow(2, zoom - 10);
        
        // Угол наклона камеры
        const pitchRad = pitch * Math.PI / 180;
        const bearingRad = -bearing * Math.PI / 180;
        
        // Позиция камеры
        const distance = altitude / Math.cos(pitchRad);
        
        this.camera.position.x = distance * Math.sin(pitchRad) * Math.sin(bearingRad);
        this.camera.position.y = -distance * Math.sin(pitchRad) * Math.cos(bearingRad);
        this.camera.position.z = altitude;
        
        this.camera.lookAt(0, 0, 0);
        
        // Обновляем центр системы координат
        this.coordinates.setCenter(center.lat, center.lng);
    }
    
    /**
     * Обработка изменения размера окна
     */
    _onResize() {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    /**
     * Цикл рендеринга
     */
    _animate() {
        requestAnimationFrame(() => this._animate());
        this.renderer.render(this.scene, this.camera);
    }
    
    /**
     * Добавить тестовый куб (для проверки)
     */
    addTestCube(x = 0, y = 0, z = 0, size = 20) {
        const geometry = new THREE.BoxGeometry(size, size, size * 2);
        const material = new THREE.MeshLambertMaterial({ color: 0x4a90d9 });
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(x, y, z + size);
        this.buildings.add(cube);
        console.log(`[SceneManager] Тестовый куб добавлен в (${x}, ${y}, ${z})`);
        return cube;
    }
    
    /**
     * Получить сцену для внешнего использования
     */
    getScene() {
        return this.scene;
    }
    
    /**
     * Получить группу зданий
     */
    getBuildingsGroup() {
        return this.buildings;
    }
}

export { SceneManager };
window.SceneManager = SceneManager;