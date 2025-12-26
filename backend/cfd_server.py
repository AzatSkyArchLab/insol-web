#!/usr/bin/env python3
"""
CFD Server v4.4 - Based on working v4.0 + Paraview fix + case_dir in result
"""
import os
import json
import asyncio
import glob
import math
import shutil
from datetime import datetime
from aiohttp import web
import aiohttp_cors

# Paths
CFD_DIR = os.path.expanduser("~/cfd")
os.makedirs(CFD_DIR, exist_ok=True)

# COST 732 Domain factors 
INLET_FACTOR = 5    # 5H до inlet 
OUTLET_FACTOR = 8   # 8H до outlet
LATERAL_FACTOR = 2.5  # 2.5H по бокам 
HEIGHT_FACTOR = 5   # 5H высота 

# ABL Parameters
KAPPA = 0.41
CMU = 0.09
Z0 = 0.5
ZREF = 10.0


class CFDServer:
    def __init__(self):
        self.status = {"status": "idle", "progress": 0, "message": ""}
        self.results = {}
        self.case_dirs = {}
        self.current_case = None
        self.current_case_dir = None  # Для отслеживания итераций
        self.current_iterations = 400  # Текущее количество итераций
        self._restore_existing_cases()
    
    def _restore_existing_cases(self):
        if not os.path.exists(CFD_DIR):
            return
        import re
        for item in os.listdir(CFD_DIR):
            if not item.startswith('case_'):
                continue
            case_dir = os.path.join(CFD_DIR, item)
            if not os.path.isdir(case_dir):
                continue
            match = re.search(r'_(\d+)deg$', item)
            if not match:
                continue
            direction = int(match.group(1))
            time_dirs = [d for d in os.listdir(case_dir) 
                        if d.replace('.', '').isdigit() and float(d) > 0]
            if time_dirs:
                self.case_dirs[direction] = case_dir
                print(f"[RESTORE] Found case for {direction}°: {item}")
        print(f"[RESTORE] Restored {len(self.case_dirs)} cases")
    
    async def health(self, request):
        return web.json_response({"status": "ok", "version": "5.4"})
    
    async def get_status(self, request):
        status = dict(self.status)
        
        # Добавляем текущую итерацию если идёт расчёт
        if status.get("status") == "running" and self.current_case_dir:
            iteration, total = self._get_current_iteration()
            if iteration > 0:
                status["iteration"] = iteration
                status["total_iterations"] = total
                # Пересчитываем прогресс на основе итераций (45-90% = CFD)
                cfd_progress = 45 + int((iteration / total) * 45)
                status["progress"] = min(cfd_progress, 89)
                status["message"] = f"Расчёт CFD... {iteration}/{total}"
        
        return web.json_response(status)
    
    def _get_current_iteration(self):
        """Парсим текущую итерацию из лога simpleFoam"""
        total = self.current_iterations
        if not self.current_case_dir:
            return 0, total
        
        log_path = os.path.join(self.current_case_dir, "log.simpleFoam")
        if not os.path.exists(log_path):
            return 0, total
        
        try:
            # Читаем последние 50 строк
            with open(log_path, 'rb') as f:
                f.seek(0, 2)  # Конец файла
                size = f.tell()
                f.seek(max(0, size - 4096))  # Последние 4KB
                lines = f.read().decode('utf-8', errors='ignore').split('\n')
            
            # Ищем последнюю строку Time = N
            for line in reversed(lines):
                if line.startswith('Time = '):
                    try:
                        iteration = int(line.split('=')[1].strip().rstrip('s'))
                        return iteration, total
                    except:
                        pass
        except:
            pass
        
        return 0, total
    
    async def get_result(self, request):
        angle = request.match_info.get('angle')
        if angle:
            angle_int = int(angle)
            if angle_int in self.results and self.results[angle_int]:
                if self.status.get("status") == "completed":
                    self.status = {"status": "idle", "progress": 0, "message": ""}
                return web.json_response(self.results[angle_int])
            if angle_int in self.case_dirs:
                try:
                    case_dir = self.case_dirs[angle_int]
                    print(f"[GET_RESULT] Extracting data for {angle_int}°")
                    result = await self._extract_results(case_dir, angle_int, 4.0, 1.75)
                    self.results[angle_int] = result
                    return web.json_response(result)
                except Exception as e:
                    print(f"[GET_RESULT] Error: {e}")
                    return web.json_response({"error": str(e)}, status=500)
            return web.json_response({"error": "Not found"}, status=404)
        
        if self.current_case is not None and self.current_case in self.results:
            if self.status.get("status") == "completed":
                self.status = {"status": "idle", "progress": 0, "message": ""}
            return web.json_response(self.results[self.current_case])
        return web.json_response({"error": "No results"}, status=404)
    
    async def get_directions(self, request):
        directions = {}
        all_dirs = set(self.results.keys()) | set(self.case_dirs.keys())
        for direction in all_dirs:
            case_dir = self.case_dirs.get(direction, "")
            case_name = os.path.basename(case_dir) if case_dir else ""
            directions[str(direction)] = {
                "case_dir": case_dir,
                "case_name": case_name,
                "has_data": direction in self.results
            }
        return web.json_response({"directions": directions})
    
    async def cleanup(self, request):
        self.results = {}
        self.case_dirs = {}
        self.current_case = None
        self.status = {"status": "idle", "progress": 0, "message": ""}
        deleted = 0
        if os.path.exists(CFD_DIR):
            for item in os.listdir(CFD_DIR):
                path = os.path.join(CFD_DIR, item)
                try:
                    if item.startswith('case_') and os.path.isdir(path):
                        shutil.rmtree(path)
                        deleted += 1
                except Exception as e:
                    print(f"[CLEANUP] Error: {e}")
        print(f"[CLEANUP] Deleted {deleted} cases")
        return web.json_response({"status": "ok", "deleted": deleted})
    
    async def resample(self, request):
        data = await request.json()
        direction = data.get('direction')
        height = data.get('height') or data.get('z', 1.75)
        if direction is None:
            direction = self.current_case
        if direction is None or direction not in self.case_dirs:
            return web.json_response({"error": "No case found"}, status=404)
        case_dir = self.case_dirs[direction]
        if not os.path.exists(case_dir):
            return web.json_response({"error": "Case directory not found"}, status=404)
        try:
            print(f"[RESAMPLE] Direction {direction}°, height={height}m")
            wind_speed = 4.0
            if direction in self.results and self.results[direction]:
                wind_speed = self.results[direction].get('wind_speed', 4.0)
            result = await self._extract_results(case_dir, direction, wind_speed, height)
            self.results[direction] = result
            return web.json_response(result)
        except Exception as e:
            print(f"[RESAMPLE] Error: {e}")
            import traceback
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)
    
    async def export_paraview(self, request):
        data = await request.json()
        direction = data.get('direction')
        if direction is None:
            direction = self.current_case
        return await self._get_paraview_info(direction)
    
    async def get_paraview(self, request):
        direction = request.match_info.get('direction')
        if direction:
            direction = int(direction)
        else:
            direction = self.current_case
        return await self._get_paraview_info(direction)
    
    async def _get_paraview_info(self, direction):
        # Принудительно преобразуем в int
        if direction is not None:
            direction = int(direction)
        
        print(f"[PARAVIEW] Request for direction: {direction}")
        print(f"[PARAVIEW] Available case_dirs: {list(self.case_dirs.keys())}")
        
        case_dir = None
        
        # Ищем в case_dirs
        if direction is not None and direction in self.case_dirs:
            case_dir = self.case_dirs[direction]
        
        # Fallback: ищем в файловой системе
        if not case_dir:
            import re
            for item in os.listdir(CFD_DIR):
                if item.startswith('case_') and item.endswith(f'_{direction}deg'):
                    case_dir = os.path.join(CFD_DIR, item)
                    print(f"[PARAVIEW] Found in filesystem: {item}")
                    break
        
        if not case_dir or not os.path.exists(case_dir):
            print(f"[PARAVIEW] Error: direction {direction} not found")
            return web.json_response({"error": "No case found"}, status=404)
        
        foam_file = "case.foam"
        foam_path = os.path.join(case_dir, foam_file)
        with open(foam_path, 'w') as f:
            f.write("")
        
        case_name = os.path.basename(case_dir)
        wsl_path = '\\\\wsl$\\Ubuntu' + case_dir.replace('/', '\\')
        
        print(f"[EXPORT] ParaView file: {foam_path}")
        
        return web.json_response({
            "status": "ok",
            "wind_direction": direction,
            "case_name": case_name,
            "case_dir": case_dir,
            "foam_file": foam_file,
            "wsl_path": wsl_path,
            "message": f"Open {foam_path} in ParaView"
        })
    
    async def list_cases(self, request):
        cases = []
        for direction, case_dir in self.case_dirs.items():
            if os.path.exists(case_dir):
                cases.append({
                    "direction": direction,
                    "path": case_dir,
                    "has_result": direction in self.results
                })
        return web.json_response({"cases": cases})
    
    async def stop(self, request):
        self.status = {"status": "stopped", "progress": 0, "message": "Остановлено"}
        return web.json_response({"status": "ok"})
    
    async def calculate(self, request):
        data = await request.json()
        asyncio.create_task(self._run_calculation(data))
        return web.json_response({"status": "started"})
    
    async def _run_calculation(self, config):
        try:
            self.status = {"status": "running", "progress": 5, "message": "Подготовка..."}
            
            direction = config.get('wind', {}).get('direction', 0)
            speed = config.get('wind', {}).get('speed', 5.0)
            buildings = config.get('buildings', {})
            settings = config.get('settings', {})
            self.current_iterations = settings.get('iterations', 400)
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            case_name = f"case_{timestamp}_{int(direction)}deg"
            case_dir = os.path.join(CFD_DIR, case_name)
            self.current_case_dir = case_dir  # Для отслеживания итераций
            
            print(f"\n{'='*60}")
            print(f"[CALC] NEW CALCULATION")
            print(f"[CALC] Direction: {direction}° | Speed: {speed:.2f} m/s")
            print(f"[CALC] Case: {case_name}")
            print(f"[CALC] Settings: inlet={settings.get('inletFactor', 'def')}, outlet={settings.get('outletFactor', 'def')}, lateral={settings.get('lateralFactor', 'def')}")
            
            self.status["progress"] = 10
            self.status["message"] = "Генерация кейса..."
            
            self._generate_case(case_dir, buildings, settings, direction, speed)
            
            self.status["progress"] = 20
            self.status["message"] = "blockMesh..."
            await self._run_command(f"cd {case_dir} && blockMesh > log.blockMesh 2>&1")
            
            self.status["progress"] = 30
            self.status["message"] = "snappyHexMesh..."
            await self._run_command(f"cd {case_dir} && snappyHexMesh -overwrite > log.snappyHexMesh 2>&1")
            
            self.status["progress"] = 45
            self.status["message"] = "Расчёт CFD..."
            await self._run_command(f"cd {case_dir} && simpleFoam > log.simpleFoam 2>&1")
            
            self.status["progress"] = 90
            self.status["message"] = "Обработка результатов..."
            
            result = await self._extract_results(case_dir, direction, speed)
            
            self.results[direction] = result
            self.case_dirs[direction] = case_dir
            self.current_case = direction
            self.current_case_dir = None  # Расчёт завершён
            
            self.status = {"status": "completed", "progress": 100, "message": "Готово"}
            print(f"[CALC] Done: {result['stats']['points']} points")
            
        except Exception as e:
            print(f"[ERROR] {e}")
            import traceback
            traceback.print_exc()
            self.current_case_dir = None  # Сбрасываем при ошибке
            self.status = {"status": "error", "progress": 0, "message": str(e)}
    
    async def _run_command(self, cmd):
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
    
    def _generate_case(self, case_dir, buildings, settings, direction, speed):
        os.makedirs(f"{case_dir}/0", exist_ok=True)
        os.makedirs(f"{case_dir}/constant/triSurface", exist_ok=True)
        os.makedirs(f"{case_dir}/system", exist_ok=True)
        
        building_list = []
        for feature in buildings.get('features', []):
            props = feature.get('properties', {})
            geom = feature.get('geometry', {})
            if geom.get('type') == 'Polygon':
                coords = geom.get('coordinates', [[]])[0]
                if len(coords) >= 3:
                    height = props.get('height', 9)
                    building_list.append({
                        'coords': [(c[0], c[1]) for c in coords],
                        'height': height
                    })
        
        all_x, all_y = [], []
        max_height = 10
        for b in building_list:
            for x, y in b['coords']:
                all_x.append(x)
                all_y.append(y)
            max_height = max(max_height, b['height'])
        
        if not all_x:
            raise Exception("No buildings found")
        
        bbox_xmin, bbox_xmax = min(all_x), max(all_x)
        bbox_ymin, bbox_ymax = min(all_y), max(all_y)
        bbox_cx = (bbox_xmin + bbox_xmax) / 2
        bbox_cy = (bbox_ymin + bbox_ymax) / 2
        bbox_width = bbox_xmax - bbox_xmin
        bbox_depth = bbox_ymax - bbox_ymin
        
        H = max_height
        rad = math.radians(direction)
        flow_x = -math.sin(rad)
        flow_y = -math.cos(rad)
        
        # Факторы домена из настроек (с fallback на глобальные константы)
        inlet_factor = settings.get('inletFactor', INLET_FACTOR)
        outlet_factor = settings.get('outletFactor', OUTLET_FACTOR)
        lateral_factor = settings.get('lateralFactor', LATERAL_FACTOR)
        height_factor = settings.get('heightFactor', HEIGHT_FACTOR)
        
        inlet_dist = inlet_factor * H
        outlet_dist = outlet_factor * H
        lateral_dist = lateral_factor * H
        domain_height = height_factor * H
        
        abs_fx, abs_fy = abs(flow_x), abs(flow_y)
        
        if flow_x >= 0:
            x_min = bbox_xmin - inlet_dist
            x_max = bbox_xmax + outlet_dist
        else:
            x_min = bbox_xmin - outlet_dist
            x_max = bbox_xmax + inlet_dist
        
        if flow_y >= 0:
            y_min = bbox_ymin - inlet_dist
            y_max = bbox_ymax + outlet_dist
        else:
            y_min = bbox_ymin - outlet_dist
            y_max = bbox_ymax + inlet_dist
        
        x_min -= lateral_dist
        x_max += lateral_dist
        y_min -= lateral_dist
        y_max += lateral_dist
        z_max = domain_height
        
        # Параметры сетки из настроек
        cell_size = settings.get('cellSize', 5)
        if cell_size <= 0:
            cell_size = 5
        iterations = settings.get('iterations', 400)
        sample_height = settings.get('sampleHeight', 1.75)
        refine_min = settings.get('refinementMin', 1)
        refine_max = settings.get('refinementMax', 2)
        max_cells = settings.get('maxCells', 3) * 1000000  # В миллионах
        
        ustar = speed * KAPPA / math.log((ZREF + Z0) / Z0)
        k_val = ustar**2 / math.sqrt(CMU)
        eps_val = ustar**3 / (KAPPA * (ZREF + Z0))
        
        print(f"[DOMAIN] Direction={direction}° | Factors: inlet={inlet_factor}H, outlet={outlet_factor}H, lateral={lateral_factor}H, height={height_factor}H")
        print(f"[DOMAIN] Flow vector: ({flow_x:.3f}, {flow_y:.3f}) | Distances: inlet={inlet_dist:.0f}m, outlet={outlet_dist:.0f}m")
        print(f"[DOMAIN] Bounds: X=[{x_min:.0f}, {x_max:.0f}], Y=[{y_min:.0f}, {y_max:.0f}], Z=[0, {z_max:.0f}]")
        print(f"[MESH] cellSize={cell_size}m, refinement=({refine_min},{refine_max}), maxCells={max_cells/1e6:.1f}M")
        print(f"[CALC] iterations={iterations}")
        print(f"[ABL] u*={ustar:.4f}, k={k_val:.4f}, eps={eps_val:.6f}")
        
        loc_x, loc_y = bbox_cx, bbox_cy
        loc_z = max_height + 5
        
        # Сохраняем metadata для центрирования результатов
        import json
        metadata = {
            'buildings_bbox': {
                'xmin': bbox_xmin, 'xmax': bbox_xmax,
                'ymin': bbox_ymin, 'ymax': bbox_ymax,
                'cx': bbox_cx, 'cy': bbox_cy,
                'width': bbox_width, 'height': bbox_depth
            },
            'max_height': max_height,
            'cell_size': cell_size,
            'direction': direction,
            'speed': speed
        }
        with open(f"{case_dir}/metadata.json", 'w') as f:
            json.dump(metadata, f)
        
        def point_in_poly(px, py, poly):
            n = len(poly)
            inside = False
            j = n - 1
            for i in range(n):
                xi, yi = poly[i]
                xj, yj = poly[j]
                if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
                    inside = not inside
                j = i
            return inside
        
        for b in building_list:
            if point_in_poly(loc_x, loc_y, b['coords']):
                loc_x = x_min + (x_max - x_min) * 0.1
                loc_y = y_min + (y_max - y_min) * 0.1
                print(f"[MESH] locationInMesh moved to: ({loc_x:.1f}, {loc_y:.1f})")
                break
        
        self._write_stl(f"{case_dir}/constant/triSurface/buildings.stl", building_list)
        
        nx = max(20, int((x_max - x_min) / cell_size))
        ny = max(20, int((y_max - y_min) / cell_size))
        nz = max(15, int(z_max / cell_size))
        
        max_grid = 150
        if nx > max_grid: nx = max_grid
        if ny > max_grid: ny = max_grid
        if nz > 50: nz = 50
        
        print(f"[MESH] Grid: {nx}x{ny}x{nz} cells")
        
        ux = flow_x * speed
        uy = flow_y * speed
        print(f"[VELOCITY] U=({ux:.2f}, {uy:.2f}, 0) m/s")
        
        with open(f"{case_dir}/system/blockMeshDict", 'w') as f:
            f.write(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      blockMeshDict;
}}
scale 1;
vertices
(
    ({x_min} {y_min} 0)
    ({x_max} {y_min} 0)
    ({x_max} {y_max} 0)
    ({x_min} {y_max} 0)
    ({x_min} {y_min} {z_max})
    ({x_max} {y_min} {z_max})
    ({x_max} {y_max} {z_max})
    ({x_min} {y_max} {z_max})
);
blocks
(
    hex (0 1 2 3 4 5 6 7) ({nx} {ny} {nz}) simpleGrading (1 1 2)
);
boundary
(
    xMin
    {{
        type patch;
        faces ((0 4 7 3));
    }}
    xMax
    {{
        type patch;
        faces ((1 2 6 5));
    }}
    yMin
    {{
        type patch;
        faces ((0 1 5 4));
    }}
    yMax
    {{
        type patch;
        faces ((3 7 6 2));
    }}
    ground
    {{
        type wall;
        faces ((0 1 2 3));
    }}
    top
    {{
        type patch;
        faces ((4 5 6 7));
    }}
);
""")
        
        with open(f"{case_dir}/system/snappyHexMeshDict", 'w') as f:
            f.write(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      snappyHexMeshDict;
}}
castellatedMesh true;
snap            true;
addLayers       false;
geometry
{{
    buildings.stl
    {{
        type triSurfaceMesh;
        name buildings;
    }}
}}
castellatedMeshControls
{{
    maxLocalCells       {int(max_cells / 5)};
    maxGlobalCells      {int(max_cells)};
    minRefinementCells  10;
    nCellsBetweenLevels 2;
    resolveFeatureAngle 30;
    features ();
    refinementSurfaces
    {{
        buildings
        {{
            level ({refine_min} {refine_max});
            patchInfo {{ type wall; }}
        }}
    }}
    refinementRegions {{ }}
    locationInMesh ({loc_x} {loc_y} {loc_z});
    allowFreeStandingZoneFaces true;
}}
snapControls
{{
    nSmoothPatch    3;
    tolerance       2.0;
    nSolveIter      50;
    nRelaxIter      5;
}}
addLayersControls
{{
    layers {{ }}
}}
meshQualityControls
{{
    maxNonOrtho 65;
    maxBoundarySkewness 20;
    maxInternalSkewness 4;
    maxConcave 80;
    minFlatness 0.5;
    minVol 1e-13;
    minArea -1;
    minTwist 0.01;
    minDeterminant 0.001;
    minFaceWeight 0.02;
    minVolRatio 0.01;
    minTriangleTwist -1;
    minTetQuality 1e-30;
    nSmoothScale 4;
    errorReduction 0.75;
}}
mergeTolerance 1e-6;
""")
        
        # Определяем BC для каждого патча на основе направления потока
        # flow_x < 0: поток идёт в -X, значит xMax = inlet
        # flow_x > 0: поток идёт в +X, значит xMin = inlet
        # flow_y < 0: поток идёт в -Y, значит yMax = inlet
        # flow_y > 0: поток идёт в +Y, значит yMin = inlet
        
        def get_patch_bc(patch_name, bc_type):
            """Генерирует BC для патча в зависимости от типа"""
            if bc_type == 'inlet':
                return f"""    {patch_name}
    {{
        type            fixedValue;
        value           uniform ({ux} {uy} 0);
    }}"""
            else:  # outlet or lateral
                return f"""    {patch_name}
    {{
        type            inletOutlet;
        inletValue      uniform ({ux} {uy} 0);
        value           uniform ({ux} {uy} 0);
    }}"""
        
        def get_patch_bc_p(patch_name, bc_type):
            """Генерирует BC давления для патча"""
            if bc_type == 'inlet':
                return f"""    {patch_name}
    {{
        type            zeroGradient;
    }}"""
            else:  # outlet
                return f"""    {patch_name}
    {{
        type            fixedValue;
        value           uniform 0;
    }}"""
        
        def get_patch_bc_k(patch_name, bc_type, k_val):
            """Генерирует BC для k"""
            if bc_type == 'inlet':
                return f"""    {patch_name}
    {{
        type            fixedValue;
        value           uniform {k_val};
    }}"""
            else:
                return f"""    {patch_name}
    {{
        type            inletOutlet;
        inletValue      uniform {k_val};
        value           uniform {k_val};
    }}"""
        
        def get_patch_bc_eps(patch_name, bc_type, eps_val):
            """Генерирует BC для epsilon"""
            if bc_type == 'inlet':
                return f"""    {patch_name}
    {{
        type            fixedValue;
        value           uniform {eps_val};
    }}"""
            else:
                return f"""    {patch_name}
    {{
        type            inletOutlet;
        inletValue      uniform {eps_val};
        value           uniform {eps_val};
    }}"""
        
        def get_patch_bc_nut(patch_name):
            """Генерирует BC для nut"""
            return f"""    {patch_name}
    {{
        type            calculated;
        value           uniform 0;
    }}"""
        
        # Определяем тип каждого патча
        # Порог для определения "значимого" компонента потока
        thresh = 0.3
        
        xMin_type = 'inlet' if flow_x > thresh else ('outlet' if flow_x < -thresh else 'lateral')
        xMax_type = 'inlet' if flow_x < -thresh else ('outlet' if flow_x > thresh else 'lateral')
        yMin_type = 'inlet' if flow_y > thresh else ('outlet' if flow_y < -thresh else 'lateral')
        yMax_type = 'inlet' if flow_y < -thresh else ('outlet' if flow_y > thresh else 'lateral')
        
        # Для диагональных направлений - используем inletOutlet на lateral
        if xMin_type == 'lateral': xMin_type = 'outlet'
        if xMax_type == 'lateral': xMax_type = 'outlet'
        if yMin_type == 'lateral': yMin_type = 'outlet'
        if yMax_type == 'lateral': yMax_type = 'outlet'
        
        print(f"[BC] Patch types: xMin={xMin_type}, xMax={xMax_type}, yMin={yMin_type}, yMax={yMax_type}")
        
        with open(f"{case_dir}/0/U", 'w') as f:
            f.write(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       volVectorField;
    object      U;
}}
dimensions      [0 1 -1 0 0 0 0];
internalField   uniform ({ux} {uy} 0);
boundaryField
{{
{get_patch_bc('xMin', xMin_type)}
{get_patch_bc('xMax', xMax_type)}
{get_patch_bc('yMin', yMin_type)}
{get_patch_bc('yMax', yMax_type)}
    ground
    {{
        type            noSlip;
    }}
    top
    {{
        type            slip;
    }}
    buildings
    {{
        type            noSlip;
    }}
}}
""")
        
        with open(f"{case_dir}/0/p", 'w') as f:
            f.write(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      p;
}}
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform 0;
boundaryField
{{
{get_patch_bc_p('xMin', xMin_type)}
{get_patch_bc_p('xMax', xMax_type)}
{get_patch_bc_p('yMin', yMin_type)}
{get_patch_bc_p('yMax', yMax_type)}
    ground
    {{
        type            zeroGradient;
    }}
    top
    {{
        type            slip;
    }}
    buildings
    {{
        type            zeroGradient;
    }}
}}
""")
        
        with open(f"{case_dir}/0/k", 'w') as f:
            f.write(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      k;
}}
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform {k_val};
boundaryField
{{
{get_patch_bc_k('xMin', xMin_type, k_val)}
{get_patch_bc_k('xMax', xMax_type, k_val)}
{get_patch_bc_k('yMin', yMin_type, k_val)}
{get_patch_bc_k('yMax', yMax_type, k_val)}
    ground
    {{
        type            kqRWallFunction;
        value           uniform {k_val};
    }}
    top
    {{
        type            zeroGradient;
    }}
    buildings
    {{
        type            kqRWallFunction;
        value           uniform {k_val};
    }}
}}
""")
        
        with open(f"{case_dir}/0/epsilon", 'w') as f:
            f.write(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      epsilon;
}}
dimensions      [0 2 -3 0 0 0 0];
internalField   uniform {eps_val};
boundaryField
{{
{get_patch_bc_eps('xMin', xMin_type, eps_val)}
{get_patch_bc_eps('xMax', xMax_type, eps_val)}
{get_patch_bc_eps('yMin', yMin_type, eps_val)}
{get_patch_bc_eps('yMax', yMax_type, eps_val)}
    ground
    {{
        type            epsilonWallFunction;
        value           uniform {eps_val};
    }}
    top
    {{
        type            zeroGradient;
    }}
    buildings
    {{
        type            epsilonWallFunction;
        value           uniform {eps_val};
    }}
}}
""")
        
        with open(f"{case_dir}/0/nut", 'w') as f:
            f.write(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      nut;
}}
dimensions      [0 2 -1 0 0 0 0];
internalField   uniform 0;
boundaryField
{{
{get_patch_bc_nut('xMin')}
{get_patch_bc_nut('xMax')}
{get_patch_bc_nut('yMin')}
{get_patch_bc_nut('yMax')}
    ground
    {{
        type            nutkWallFunction;
        value           uniform 0;
    }}
    top
    {{
        type            calculated;
        value           uniform 0;
    }}
    buildings
    {{
        type            nutkWallFunction;
        value           uniform 0;
    }}
}}
""")
        
        with open(f"{case_dir}/system/controlDict", 'w') as f:
            f.write(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      controlDict;
}}
application     simpleFoam;
startFrom       startTime;
startTime       0;
stopAt          endTime;
endTime         {iterations};
deltaT          1;
writeControl    timeStep;
writeInterval   {iterations};
purgeWrite      1;
writeFormat     ascii;
writePrecision  8;
writeCompression off;
timeFormat      general;
timePrecision   6;
runTimeModifiable true;
""")
        
        with open(f"{case_dir}/system/fvSchemes", 'w') as f:
            f.write("""FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      fvSchemes;
}
ddtSchemes
{
    default         steadyState;
}
gradSchemes
{
    default         Gauss linear;
}
divSchemes
{
    default         none;
    div(phi,U)      bounded Gauss linearUpwind grad(U);
    div(phi,k)      bounded Gauss upwind;
    div(phi,epsilon) bounded Gauss upwind;
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes
{
    default         Gauss linear corrected;
}
interpolationSchemes
{
    default         linear;
}
snGradSchemes
{
    default         corrected;
}
wallDist
{
    method          meshWave;
}
""")
        
        with open(f"{case_dir}/system/fvSolution", 'w') as f:
            f.write("""FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      fvSolution;
}
solvers
{
    p
    {
        solver          GAMG;
        tolerance       1e-06;
        relTol          0.01;
        smoother        GaussSeidel;
    }
    U
    {
        solver          smoothSolver;
        smoother        symGaussSeidel;
        tolerance       1e-06;
        relTol          0.01;
    }
    k
    {
        solver          smoothSolver;
        smoother        symGaussSeidel;
        tolerance       1e-06;
        relTol          0.01;
    }
    epsilon
    {
        solver          smoothSolver;
        smoother        symGaussSeidel;
        tolerance       1e-06;
        relTol          0.01;
    }
}
SIMPLE
{
    nNonOrthogonalCorrectors 1;
    consistent      yes;
    pRefCell        0;
    pRefValue       0;
    residualControl
    {
        p               1e-4;
        U               1e-4;
        k               1e-4;
        epsilon         1e-4;
    }
}
relaxationFactors
{
    fields
    {
        p               0.3;
    }
    equations
    {
        U               0.5;
        k               0.3;
        epsilon         0.3;
    }
}
""")
        
        n_procs = min(4, os.cpu_count() or 1)
        with open(f"{case_dir}/system/decomposeParDict", 'w') as f:
            f.write(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      decomposeParDict;
}}
numberOfSubdomains {n_procs};
method          scotch;
""")
        
        with open(f"{case_dir}/constant/transportProperties", 'w') as f:
            f.write("""FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      transportProperties;
}
transportModel  Newtonian;
nu              nu [0 2 -1 0 0 0 0] 1.5e-05;
""")
        
        with open(f"{case_dir}/constant/turbulenceProperties", 'w') as f:
            f.write("""FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      turbulenceProperties;
}
simulationType  RAS;
RAS
{
    RASModel        kEpsilon;
    turbulence      on;
    printCoeffs     on;
}
""")
    
    def _write_stl(self, path, buildings):
        lines = ["solid buildings"]
        for b in buildings:
            coords = list(b['coords'])
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            h = b['height']
            for i in range(len(coords) - 1):
                x0, y0 = coords[i]
                x1, y1 = coords[i + 1]
                dx, dy = x1 - x0, y1 - y0
                length = math.sqrt(dx*dx + dy*dy)
                if length < 0.001:
                    continue
                nx, ny = dy/length, -dx/length
                lines.append(f"  facet normal {nx} {ny} 0")
                lines.append("    outer loop")
                lines.append(f"      vertex {x0} {y0} 0")
                lines.append(f"      vertex {x1} {y1} 0")
                lines.append(f"      vertex {x1} {y1} {h}")
                lines.append("    endloop")
                lines.append("  endfacet")
                lines.append(f"  facet normal {nx} {ny} 0")
                lines.append("    outer loop")
                lines.append(f"      vertex {x0} {y0} 0")
                lines.append(f"      vertex {x1} {y1} {h}")
                lines.append(f"      vertex {x0} {y0} {h}")
                lines.append("    endloop")
                lines.append("  endfacet")
            if len(coords) >= 4:
                cx = sum(c[0] for c in coords[:-1]) / (len(coords) - 1)
                cy = sum(c[1] for c in coords[:-1]) / (len(coords) - 1)
                for i in range(len(coords) - 1):
                    x0, y0 = coords[i]
                    x1, y1 = coords[i + 1]
                    lines.append("  facet normal 0 0 1")
                    lines.append("    outer loop")
                    lines.append(f"      vertex {cx} {cy} {h}")
                    lines.append(f"      vertex {x0} {y0} {h}")
                    lines.append(f"      vertex {x1} {y1} {h}")
                    lines.append("    endloop")
                    lines.append("  endfacet")
                    lines.append("  facet normal 0 0 -1")
                    lines.append("    outer loop")
                    lines.append(f"      vertex {cx} {cy} 0")
                    lines.append(f"      vertex {x1} {y1} 0")
                    lines.append(f"      vertex {x0} {y0} 0")
                    lines.append("    endloop")
                    lines.append("  endfacet")
        lines.append("endsolid buildings")
        with open(path, 'w') as f:
            f.write('\n'.join(lines))
    
    async def _extract_results(self, case_dir, direction, speed, sample_height=1.75):
        time_dirs = []
        for d in os.listdir(case_dir):
            try:
                t = float(d)
                if t > 0:
                    time_dirs.append(d)
            except:
                pass
        if not time_dirs:
            raise Exception("No time directories found")
        
        last_time = sorted(time_dirs, key=float)[-1]
        print(f"[EXTRACT] Time step: {last_time}, height: {sample_height}m")
        
        # Читаем metadata для центрирования
        import json
        metadata_path = f"{case_dir}/metadata.json"
        buildings_bbox = None
        if os.path.exists(metadata_path):
            with open(metadata_path) as f:
                metadata = json.load(f)
                buildings_bbox = metadata.get('buildings_bbox')
                print(f"[EXTRACT] Buildings bbox: {buildings_bbox}")
        
        sample_dict = f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      sampleDict;
}}
type            surfaces;
libs            ("libsampling.so");
interpolationScheme cellPoint;
surfaceFormat   vtk;
fields          ( U );
surfaces
(
    zSlice
    {{
        type            cuttingPlane;
        planeType       pointAndNormal;
        pointAndNormalDict
        {{
            point       (0 0 {sample_height});
            normal      (0 0 1);
        }}
        interpolate     true;
    }}
);
"""
        with open(f"{case_dir}/system/sampleDict", 'w') as f:
            f.write(sample_dict)
        
        pp_dir = f"{case_dir}/postProcessing/sampleDict"
        if os.path.exists(pp_dir):
            shutil.rmtree(pp_dir)
        
        print("[EXTRACT] Running postProcess...")
        proc = await asyncio.create_subprocess_shell(
            f"cd {case_dir} && postProcess -func sampleDict -latestTime",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        
        vtk_file = None
        for pattern in [f"{case_dir}/postProcessing/sampleDict/{last_time}/zSlice.vtk",
                       f"{case_dir}/postProcessing/sampleDict/*/zSlice.vtk"]:
            matches = glob.glob(pattern)
            if matches:
                vtk_file = matches[0]
                break
        
        if not vtk_file:
            raise Exception("VTK result not found")
        
        print(f"[EXTRACT] VTK: {vtk_file}")
        
        points = self._parse_vtk(vtk_file)
        print(f"[EXTRACT] Raw points: {len(points)}")
        
        if not points:
            raise Exception("No points in result")
        
        # Определяем границы grid - центрируем по bbox зданий с запасом 2H
        if buildings_bbox:
            # Центр и размер по зданиям + запас
            H = metadata.get('max_height', 20)
            margin = 2 * H  # 2H запас вокруг зданий
            x_min = buildings_bbox['xmin'] - margin
            x_max = buildings_bbox['xmax'] + margin
            y_min = buildings_bbox['ymin'] - margin
            y_max = buildings_bbox['ymax'] + margin
            print(f"[GRID] Centered on buildings with {margin:.0f}m margin")
        else:
            # Fallback: весь домен с 10% margin
            all_x = [p['x'] for p in points]
            all_y = [p['y'] for p in points]
            x_min_raw, x_max_raw = min(all_x), max(all_x)
            y_min_raw, y_max_raw = min(all_y), max(all_y)
            margin_x = (x_max_raw - x_min_raw) * 0.10
            margin_y = (y_max_raw - y_min_raw) * 0.10
            x_min = x_min_raw + margin_x
            x_max = x_max_raw - margin_x
            y_min = y_min_raw + margin_y
            y_max = y_max_raw - margin_y
            print(f"[GRID] Trimmed margins: {margin_x:.1f}m x {margin_y:.1f}m")
        
        spacing = 5.0
        nx = max(10, int((x_max - x_min) / spacing) + 1)
        ny = max(10, int((y_max - y_min) / spacing) + 1)
        
        if nx > 200:
            nx = 200
            spacing = (x_max - x_min) / (nx - 1)
        if ny > 200:
            ny = 200
        
        print(f"[GRID] Building {nx}x{ny} grid")
        
        from collections import defaultdict
        cell_size = spacing * 0.6
        point_cells = defaultdict(list)
        for p in points:
            cx = int(p['x'] / cell_size)
            cy = int(p['y'] / cell_size)
            point_cells[(cx, cy)].append(p)
        
        grid_2d = []
        vectors = []
        
        for iy in range(ny):
            y = y_min + iy * spacing
            row = []
            vec_row = []
            for ix in range(nx):
                x = x_min + ix * spacing
                cx = int(x / cell_size)
                cy = int(y / cell_size)
                best_p = None
                best_dist = float('inf')
                for dcx in [-1, 0, 1]:
                    for dcy in [-1, 0, 1]:
                        for p in point_cells.get((cx + dcx, cy + dcy), []):
                            dist = (p['x'] - x)**2 + (p['y'] - y)**2
                            if dist < best_dist:
                                best_dist = dist
                                best_p = p
                if best_p and best_dist < (spacing * 1.5)**2:
                    row.append(best_p['speed'])
                    vec_row.append([best_p.get('vx', 0), best_p.get('vy', 0)])
                else:
                    row.append(0)
                    vec_row.append([0, 0])
            grid_2d.append(row)
            vectors.append(vec_row)
        
        # Считаем статистику из финального grid_2d
        all_speeds = [v for row in grid_2d for v in row if v > 0.01]
        if all_speeds:
            min_speed, max_speed = min(all_speeds), max(all_speeds)
        else:
            min_speed, max_speed = 0, speed
        
        print(f"[GRID] Speed range (grid): {min_speed:.2f} - {max_speed:.2f} m/s")
        
        vx_grid = [[v[0] for v in row] for row in vectors]
        vy_grid = [[v[1] for v in row] for row in vectors]
        
        return {
            "wind_direction": direction,
            "wind_speed": speed,
            "sample_height": sample_height,
            "grid": {
                "nx": nx,
                "ny": ny,
                "spacing": round(spacing, 2),
                "origin": [round(x_min, 2), round(y_min, 2)],
                "values": grid_2d,
                "vx": vx_grid,
                "vy": vy_grid
            },
            "buildings_bbox": buildings_bbox,
            "stats": {
                "min_speed": round(min_speed, 4),
                "max_speed": round(max_speed, 4),
                "points": len(points)
            },
            "case_dir": case_dir,
            "case_name": os.path.basename(case_dir)
        }
    
    def _parse_vtk(self, filepath):
        with open(filepath, 'r') as f:
            content = f.read()
        points = []
        coords = []
        velocities = []
        lines = content.split('\n')
        i = 0
        n_points = 0
        while i < len(lines):
            line = lines[i].strip()
            if line.startswith('POINTS'):
                parts = line.split()
                n_points = int(parts[1])
                i += 1
                coord_values = []
                while len(coord_values) < n_points * 3 and i < len(lines):
                    for v in lines[i].split():
                        try:
                            coord_values.append(float(v))
                        except:
                            pass
                    i += 1
                coords = [(coord_values[j], coord_values[j+1], coord_values[j+2]) 
                         for j in range(0, min(len(coord_values), n_points*3), 3)]
                continue
            if 'VECTORS' in line and 'U' in line:
                i += 1
                vel_values = []
                while len(vel_values) < n_points * 3 and i < len(lines):
                    for v in lines[i].split():
                        try:
                            vel_values.append(float(v))
                        except:
                            pass
                    i += 1
                velocities = [(vel_values[j], vel_values[j+1], vel_values[j+2]) 
                             for j in range(0, min(len(vel_values), n_points*3), 3)]
                break
            if line.startswith('FIELD'):
                i += 1
                if i < len(lines):
                    field_line = lines[i].strip()
                    if field_line.startswith('U '):
                        parts = field_line.split()
                        if len(parts) >= 3:
                            field_n = int(parts[2])
                            i += 1
                            vel_values = []
                            while len(vel_values) < field_n * 3 and i < len(lines):
                                for v in lines[i].split():
                                    try:
                                        vel_values.append(float(v))
                                    except:
                                        pass
                                i += 1
                            velocities = [(vel_values[j], vel_values[j+1], vel_values[j+2]) 
                                         for j in range(0, min(len(vel_values), field_n*3), 3)]
                            break
                continue
            i += 1
        for idx, (x, y, z) in enumerate(coords):
            if idx < len(velocities):
                ux, uy, uz = velocities[idx]
                speed = math.sqrt(ux*ux + uy*uy + uz*uz)
                points.append({
                    "x": round(x, 2),
                    "y": round(y, 2),
                    "speed": round(speed, 4),
                    "vx": round(ux, 4),
                    "vy": round(uy, 4)
                })
        return points


def create_app():
    app = web.Application()
    server = CFDServer()
    
    app.router.add_get('/health', server.health)
    app.router.add_get('/status', server.get_status)
    app.router.add_get('/result', server.get_result)
    app.router.add_get('/result/{angle}', server.get_result)
    app.router.add_get('/directions', server.get_directions)
    app.router.add_get('/cases', server.list_cases)
    app.router.add_post('/calculate', server.calculate)
    app.router.add_post('/cleanup', server.cleanup)
    app.router.add_post('/stop', server.stop)
    app.router.add_post('/resample', server.resample)
    app.router.add_post('/export', server.export_paraview)
    app.router.add_get('/paraview/{direction}', server.get_paraview)
    
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
            allow_methods="*"
        )
    })
    for route in list(app.router.routes()):
        cors.add(route)
    
    return app

if __name__ == '__main__':
    print("=" * 60)
    print("CFD Server v4.4 - Based on working v4.0 + fixes")
    print("=" * 60)
    print(f"CFD directory: {CFD_DIR}")
    print("Starting on http://0.0.0.0:8765")
    print("=" * 60)
    
    app = create_app()
    web.run_app(app, host='0.0.0.0', port=8765)
