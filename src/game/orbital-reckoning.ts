import * as THREE from "three";

export type Phase = "ready" | "running" | "gameover";
export type VirtualKey = "up" | "down" | "left" | "right" | "fire";

export interface HudSnapshot {
  phase: Phase;
  title: string;
  subtitle: string;
  health: number;
  shield: number;
  score: number;
  wave: number;
  enemies: number;
  dashReady: boolean;
  statusText: string;
  objectiveText: string;
}

interface GameCallbacks {
  onHudChange: (snapshot: HudSnapshot) => void;
}

type EnemyKind = "scout" | "spitter" | "crusher";
type ProjectileSource = "player" | "enemy";

interface Enemy {
  id: number;
  kind: EnemyKind;
  group: THREE.Group;
  body: THREE.Group;
  rotor?: THREE.Object3D | null;
  velocity: THREE.Vector3;
  radius: number;
  speed: number;
  health: number;
  damage: number;
  score: number;
  contactCooldown: number;
  fireCooldown: number;
  hoverOffset: number;
  orbitDirection: number;
  punch: number;
}

interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  damage: number;
  radius: number;
  source: ProjectileSource;
}

interface Pickup {
  mesh: THREE.Mesh;
  life: number;
  spin: number;
  value: number;
  radius: number;
}

interface Burst {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  ttl: number;
  growth: number;
}

const ARENA_RADIUS = 24;
const PLAYER_HEIGHT = 0.9;
const PLAYER_SPEED = 11;
const PLAYER_FIRE_RATE = 0.18;
const PLAYER_PROJECTILE_SPEED = 36;
const ENEMY_PROJECTILE_SPEED = 20;
const PLAYER_MAX_HEALTH = 100;
const PLAYER_MAX_SHIELD = 80;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function dampAngle(current: number, target: number, smoothing: number, delta: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * (1 - Math.exp(-smoothing * delta));
}

function shuffle<T>(values: T[]): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }

  return values;
}

export class OrbitalReckoningGame {
  private readonly container: HTMLElement;
  private readonly callbacks: GameCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly pointer = new THREE.Vector2(0, 0);
  private readonly aimPoint = new THREE.Vector3(0, PLAYER_HEIGHT, 12);
  private readonly environment = new THREE.Group();
  private readonly dynamicRoot = new THREE.Group();
  private readonly playerRoot = new THREE.Group();
  private readonly playerVelocity = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly keys = new Set<string>();
  private readonly mobileState: Record<VirtualKey, boolean> = {
    up: false,
    down: false,
    left: false,
    right: false,
    fire: false
  };
  private readonly tempA = new THREE.Vector3();
  private readonly tempB = new THREE.Vector3();
  private readonly tempC = new THREE.Vector3();
  private readonly projectileGeometry = new THREE.SphereGeometry(0.18, 12, 12);
  private readonly burstGeometry = new THREE.SphereGeometry(0.45, 16, 16);
  private readonly pickupGeometry = new THREE.OctahedronGeometry(0.55, 0);
  private readonly playerShotMaterial = new THREE.MeshBasicMaterial({ color: 0x74f5ff });
  private readonly enemyShotMaterial = new THREE.MeshBasicMaterial({ color: 0xff8f62 });
  private readonly pickupMaterial = new THREE.MeshStandardMaterial({
    color: 0xf8d46f,
    emissive: 0xff953d,
    emissiveIntensity: 0.8,
    roughness: 0.35,
    metalness: 0.42
  });

  private animationFrame = 0;
  private time = 0;
  private phase: Phase = "ready";
  private wave = 1;
  private score = 0;
  private playerHeading = 0;
  private playerHealth = PLAYER_MAX_HEALTH;
  private playerShield = 60;
  private playerFireCooldown = 0;
  private playerDashCooldown = 0;
  private playerInvulnerability = 0;
  private pointerDown = false;
  private dashRequested = false;
  private statusText = "Nhấn BẮT ĐẦU để vào đấu trường.";
  private statusTimer = 0;
  private spawnQueue: EnemyKind[] = [];
  private spawnCooldown = 0;
  private waveCleared = false;
  private intermission = -1;
  private lastHudEmission = -1;
  private isCoarsePointer = false;
  private nextEnemyId = 1;
  private playerEngineGlow: THREE.Mesh | null = null;
  private coreSpin: THREE.Group | null = null;
  private arenaRing: THREE.Mesh | null = null;

  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private pickups: Pickup[] = [];
  private bursts: Burst[] = [];

  constructor(container: HTMLElement, callbacks: GameCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x040814);
    this.scene.fog = new THREE.Fog(0x040814, 26, 76);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 180);
    this.camera.position.set(0, 8, -12);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";

    this.container.appendChild(this.renderer.domElement);
    this.scene.add(this.environment);
    this.scene.add(this.dynamicRoot);
    this.scene.add(this.playerRoot);

    this.isCoarsePointer =
      window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(hover: none)").matches;

    this.buildLights();
    this.buildArena();
    this.buildPlayer();
    this.resetPlayerPose();
    this.bindEvents();
    this.handleResize();
    this.emitHud(true);

    this.clock.start();
    this.animate();
  }

  startMission(): void {
    this.phase = "running";
    this.wave = 1;
    this.score = 0;
    this.playerHealth = PLAYER_MAX_HEALTH;
    this.playerShield = 60;
    this.playerFireCooldown = 0;
    this.playerDashCooldown = 0;
    this.playerInvulnerability = 0;
    this.pointerDown = false;
    this.dashRequested = false;
    this.waveCleared = false;
    this.intermission = -1;
    this.statusTimer = 2.3;
    this.statusText = "Wave 1 đang đổ bộ.";

    this.resetPlayerPose();
    this.clearDynamicState();
    this.prepareWave(this.wave);
    this.emitHud(true);
  }

  triggerDash(): void {
    this.dashRequested = true;
  }

  setVirtualKey(key: VirtualKey, active: boolean): void {
    this.mobileState[key] = active;
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.unbindEvents();
    this.clearDynamicState();
    this.playerShotMaterial.dispose();
    this.enemyShotMaterial.dispose();
    this.pickupMaterial.dispose();
    this.projectileGeometry.dispose();
    this.burstGeometry.dispose();
    this.pickupGeometry.dispose();

    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      object.geometry.dispose();
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose());
      } else {
        object.material.dispose();
      }
    });

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0x8eb6ff, 0x180f08, 1.4);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3c2, 1.55);
    sun.position.set(12, 18, 10);
    this.scene.add(sun);

    const coreGlow = new THREE.PointLight(0x4de4ff, 4.8, 26, 2);
    coreGlow.position.set(0, 6, 0);
    this.scene.add(coreGlow);
  }

  private buildArena(): void {
    const groundTexture = this.createGroundTexture();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(96, 96),
      new THREE.MeshStandardMaterial({
        map: groundTexture,
        color: 0x0a1020,
        emissive: 0x060d19,
        emissiveIntensity: 0.7,
        roughness: 0.88,
        metalness: 0.18
      })
    );
    ground.rotation.x = -Math.PI / 2;
    this.environment.add(ground);

    const deckGlow = new THREE.Mesh(
      new THREE.RingGeometry(12, ARENA_RADIUS + 1.1, 64),
      new THREE.MeshBasicMaterial({
        color: 0x12395d,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    deckGlow.rotation.x = -Math.PI / 2;
    deckGlow.position.y = 0.03;
    this.environment.add(deckGlow);

    this.arenaRing = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA_RADIUS + 0.4, 0.42, 18, 80),
      new THREE.MeshStandardMaterial({
        color: 0x7ee9ff,
        emissive: 0x164b62,
        emissiveIntensity: 1.1,
        metalness: 0.72,
        roughness: 0.22
      })
    );
    this.arenaRing.rotation.x = Math.PI / 2;
    this.arenaRing.position.y = 0.65;
    this.environment.add(this.arenaRing);

    for (let index = 0; index < 18; index += 1) {
      const angle = (index / 18) * Math.PI * 2;
      const distance = randomBetween(11, ARENA_RADIUS - 3.8);
      const height = randomBetween(2.4, 7.2);

      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(randomBetween(0.5, 1.1), randomBetween(0.7, 1.3), height, 8),
        new THREE.MeshStandardMaterial({
          color: index % 2 === 0 ? 0x20293c : 0x36261e,
          emissive: index % 2 === 0 ? 0x0f1829 : 0x2a140e,
          emissiveIntensity: 0.35,
          roughness: 0.78,
          metalness: 0.32
        })
      );
      tower.position.set(Math.cos(angle) * distance, height / 2, Math.sin(angle) * distance);
      this.environment.add(tower);

      const beacon = new THREE.Mesh(
        new THREE.TorusGeometry(0.78, 0.08, 8, 22),
        new THREE.MeshBasicMaterial({
          color: index % 2 === 0 ? 0x5ef2ff : 0xff8f62,
          transparent: true,
          opacity: 0.9
        })
      );
      beacon.rotation.x = Math.PI / 2;
      beacon.position.set(tower.position.x, height + 0.25, tower.position.z);
      this.environment.add(beacon);
    }

    this.coreSpin = new THREE.Group();
    const coreBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 2.5, 1.2, 10),
      new THREE.MeshStandardMaterial({
        color: 0x273148,
        emissive: 0x0b1626,
        emissiveIntensity: 0.45,
        roughness: 0.64,
        metalness: 0.55
      })
    );
    coreBase.position.y = 0.6;
    this.environment.add(coreBase);

    const coreCrystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.95, 0),
      new THREE.MeshStandardMaterial({
        color: 0x7ef7ff,
        emissive: 0x3dc7d7,
        emissiveIntensity: 1.3,
        roughness: 0.12,
        metalness: 0.2
      })
    );
    coreCrystal.position.y = 2.1;
    this.coreSpin.add(coreCrystal);

    const coreRingA = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.12, 10, 40),
      new THREE.MeshStandardMaterial({
        color: 0x79e4ff,
        emissive: 0x1f5876,
        emissiveIntensity: 0.9,
        roughness: 0.22,
        metalness: 0.74
      })
    );
    coreRingA.rotation.x = Math.PI / 2;
    coreRingA.position.y = 2.05;
    this.coreSpin.add(coreRingA);

    const coreRingB = new THREE.Mesh(
      new THREE.TorusGeometry(1.35, 0.08, 10, 30),
      new THREE.MeshStandardMaterial({
        color: 0xffb26f,
        emissive: 0x8d4d22,
        emissiveIntensity: 0.85,
        roughness: 0.28,
        metalness: 0.62
      })
    );
    coreRingB.rotation.set(Math.PI / 3, 0, Math.PI / 2.4);
    coreRingB.position.y = 2.05;
    this.coreSpin.add(coreRingB);

    this.environment.add(this.coreSpin);
    this.environment.add(this.createStarField());
  }

  private buildPlayer(): void {
    this.playerRoot.add(this.createShadowDisc(1.45, 0.34));

    const hullMaterial = new THREE.MeshStandardMaterial({
      color: 0xc8d1e0,
      emissive: 0x172235,
      emissiveIntensity: 0.35,
      roughness: 0.2,
      metalness: 0.74
    });

    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.26, 0.94, 10), hullMaterial);
    hull.position.y = PLAYER_HEIGHT;
    this.playerRoot.add(hull);

    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(0.56, 18, 18),
      new THREE.MeshStandardMaterial({
        color: 0x9af4ff,
        emissive: 0x3bb5c7,
        emissiveIntensity: 0.95,
        roughness: 0.12,
        metalness: 0.24
      })
    );
    cockpit.position.set(0, PLAYER_HEIGHT + 0.45, 0.12);
    this.playerRoot.add(cockpit);

    const cannon = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.34, 1.84),
      new THREE.MeshStandardMaterial({
        color: 0xf0c37e,
        emissive: 0x7a431f,
        emissiveIntensity: 0.75,
        roughness: 0.25,
        metalness: 0.62
      })
    );
    cannon.position.set(0, PLAYER_HEIGHT + 0.2, 1.12);
    this.playerRoot.add(cannon);

    const finGeometry = new THREE.BoxGeometry(0.22, 0.28, 1.3);
    const finMaterial = new THREE.MeshStandardMaterial({
      color: 0x2f3a4d,
      emissive: 0x121d2f,
      emissiveIntensity: 0.4,
      roughness: 0.56,
      metalness: 0.42
    });

    const finLeft = new THREE.Mesh(finGeometry, finMaterial);
    finLeft.position.set(-1.05, PLAYER_HEIGHT + 0.08, -0.1);
    finLeft.rotation.z = -0.26;
    this.playerRoot.add(finLeft);

    const finRight = new THREE.Mesh(finGeometry, finMaterial);
    finRight.position.set(1.05, PLAYER_HEIGHT + 0.08, -0.1);
    finRight.rotation.z = 0.26;
    this.playerRoot.add(finRight);

    this.playerEngineGlow = new THREE.Mesh(
      new THREE.TorusGeometry(0.68, 0.18, 10, 24),
      new THREE.MeshStandardMaterial({
        color: 0xffc97a,
        emissive: 0xff7b3f,
        emissiveIntensity: 1.15,
        roughness: 0.14,
        metalness: 0.28
      })
    );
    this.playerEngineGlow.rotation.x = Math.PI / 2;
    this.playerEngineGlow.position.set(0, PLAYER_HEIGHT + 0.15, -0.95);
    this.playerRoot.add(this.playerEngineGlow);
  }

  private buildEnemy(kind: EnemyKind): Pick<Enemy, "group" | "body" | "rotor"> {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(this.createShadowDisc(kind === "crusher" ? 1.38 : 0.98, kind === "crusher" ? 0.31 : 0.24));
    group.add(body);

    let rotor: THREE.Object3D | null = null;

    if (kind === "scout") {
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.72, 0),
        new THREE.MeshStandardMaterial({
          color: 0xffb67a,
          emissive: 0xcc5b23,
          emissiveIntensity: 0.8,
          roughness: 0.28,
          metalness: 0.52
        })
      );
      body.add(core);

      rotor = new THREE.Mesh(
        new THREE.TorusGeometry(1.02, 0.08, 8, 28),
        new THREE.MeshStandardMaterial({
          color: 0xffd7a0,
          emissive: 0x6d3113,
          emissiveIntensity: 0.65,
          roughness: 0.22,
          metalness: 0.68
        })
      );
      rotor.rotation.x = Math.PI / 2;
      body.add(rotor);

      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.18, 0.28),
        new THREE.MeshStandardMaterial({
          color: 0x4a2d23,
          emissive: 0x27110c,
          emissiveIntensity: 0.3,
          roughness: 0.48,
          metalness: 0.38
        })
      );
      body.add(wing);
    }

    if (kind === "spitter") {
      const shell = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.84, 0),
        new THREE.MeshStandardMaterial({
          color: 0xff8f6a,
          emissive: 0x882f1f,
          emissiveIntensity: 0.95,
          roughness: 0.24,
          metalness: 0.44
        })
      );
      body.add(shell);

      const cannonMaterial = new THREE.MeshStandardMaterial({
        color: 0x44231b,
        emissive: 0x29120e,
        emissiveIntensity: 0.36,
        roughness: 0.54,
        metalness: 0.3
      });

      const cannonLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.28, 10), cannonMaterial);
      cannonLeft.rotation.z = Math.PI / 2;
      cannonLeft.position.set(-0.82, -0.02, 0.12);
      body.add(cannonLeft);

      const cannonRight = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.28, 10), cannonMaterial);
      cannonRight.rotation.z = Math.PI / 2;
      cannonRight.position.set(0.82, -0.02, 0.12);
      body.add(cannonRight);

      rotor = new THREE.Mesh(
        new THREE.TorusGeometry(0.92, 0.06, 8, 22),
        new THREE.MeshStandardMaterial({
          color: 0x79e3ff,
          emissive: 0x204f6e,
          emissiveIntensity: 0.82,
          roughness: 0.24,
          metalness: 0.66
        })
      );
      rotor.rotation.set(Math.PI / 4, Math.PI / 4, 0);
      body.add(rotor);
    }

    if (kind === "crusher") {
      const frame = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.02, 0),
        new THREE.MeshStandardMaterial({
          color: 0xffb489,
          emissive: 0x9b421f,
          emissiveIntensity: 0.85,
          roughness: 0.32,
          metalness: 0.42
        })
      );
      body.add(frame);

      const armorMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a3130,
        emissive: 0x22110f,
        emissiveIntensity: 0.38,
        roughness: 0.68,
        metalness: 0.34
      });

      for (const direction of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.7, 1.6), armorMaterial);
        plate.position.set(direction * 1.06, 0, 0);
        plate.rotation.z = direction * 0.18;
        body.add(plate);
      }

      rotor = new THREE.Mesh(
        new THREE.TorusGeometry(1.3, 0.11, 10, 28),
        new THREE.MeshStandardMaterial({
          color: 0xffdfb4,
          emissive: 0x6d3113,
          emissiveIntensity: 0.56,
          roughness: 0.18,
          metalness: 0.76
        })
      );
      rotor.rotation.set(Math.PI / 2, 0, Math.PI / 4);
      body.add(rotor);
    }

    return { group, body, rotor };
  }

  private spawnEnemy(kind: EnemyKind): void {
    const angle = randomBetween(0, Math.PI * 2);
    const distance = randomBetween(ARENA_RADIUS - 2.2, ARENA_RADIUS - 0.8);
    const { group, body, rotor } = this.buildEnemy(kind);
    group.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
    this.dynamicRoot.add(group);

    const stats =
      kind === "scout"
        ? {
            radius: 0.95,
            speed: 4.6 + this.wave * 0.12,
            health: 28 + this.wave * 3,
            damage: 12 + this.wave * 0.4,
            score: 100
          }
        : kind === "spitter"
          ? {
              radius: 1.05,
              speed: 3.25 + this.wave * 0.08,
              health: 44 + this.wave * 4,
              damage: 10 + this.wave * 0.35,
              score: 150
            }
          : {
              radius: 1.35,
              speed: 2.65 + this.wave * 0.06,
              health: 88 + this.wave * 7,
              damage: 22 + this.wave * 0.6,
              score: 240
            };

    this.enemies.push({
      id: this.nextEnemyId,
      kind,
      group,
      body,
      rotor,
      velocity: new THREE.Vector3(),
      radius: stats.radius,
      speed: stats.speed,
      health: stats.health,
      damage: stats.damage,
      score: stats.score,
      contactCooldown: 0,
      fireCooldown: kind === "spitter" ? randomBetween(0.55, 1.3) : 0,
      hoverOffset: this.nextEnemyId * 0.7,
      orbitDirection: Math.random() > 0.5 ? 1 : -1,
      punch: 0
    });

    this.nextEnemyId += 1;
    this.addBurst(group.position.clone().setY(1.2), 0xff965b, 0.7, 0.22);
  }

  private spawnPickup(position: THREE.Vector3, value: number): void {
    const mesh = new THREE.Mesh(this.pickupGeometry, this.pickupMaterial);
    mesh.position.copy(position);
    mesh.position.y = 1.1;
    this.dynamicRoot.add(mesh);

    this.pickups.push({
      mesh,
      life: 10,
      spin: randomBetween(0, Math.PI * 2),
      value,
      radius: 1.45
    });
  }

  private spawnPlayerShot(): void {
    const forward = this.tempA.set(Math.sin(this.playerHeading), 0, Math.cos(this.playerHeading));
    const origin = this.tempB
      .copy(this.playerRoot.position)
      .addScaledVector(forward, 1.95)
      .setY(PLAYER_HEIGHT + 0.25);

    const direction = this.aimPoint.clone().sub(origin);
    direction.y = 0;
    if (direction.lengthSq() < 0.01) {
      direction.copy(forward);
    }
    direction.normalize();

    const projectile = new THREE.Mesh(this.projectileGeometry, this.playerShotMaterial);
    projectile.position.copy(origin);
    this.dynamicRoot.add(projectile);

    this.projectiles.push({
      mesh: projectile,
      velocity: direction.multiplyScalar(PLAYER_PROJECTILE_SPEED),
      life: 1.35,
      damage: 26,
      radius: 0.62,
      source: "player"
    });

    this.playerFireCooldown = PLAYER_FIRE_RATE;
    this.addBurst(origin.clone(), 0x7ef4ff, 0.48, 0.16);
  }

  private spawnEnemyShot(enemy: Enemy): void {
    const origin = enemy.group.position.clone();
    origin.y = enemy.body.position.y + 0.2;

    const target = this.playerRoot.position.clone().setY(PLAYER_HEIGHT + 0.2);
    target.addScaledVector(this.playerVelocity, 0.06);

    const direction = target.sub(origin);
    direction.y = 0;
    direction.normalize();

    const projectile = new THREE.Mesh(this.projectileGeometry, this.enemyShotMaterial);
    projectile.position.copy(origin);
    projectile.scale.setScalar(0.95);
    this.dynamicRoot.add(projectile);

    this.projectiles.push({
      mesh: projectile,
      velocity: direction.multiplyScalar(ENEMY_PROJECTILE_SPEED),
      life: 2.2,
      damage: 12 + this.wave * 0.4,
      radius: 0.72,
      source: "enemy"
    });
  }

  private update(delta: number): void {
    this.time += delta;
    if (this.statusTimer > 0) {
      this.statusTimer = Math.max(0, this.statusTimer - delta);
    }

    this.updateEnvironment(delta);
    this.updateBursts(delta);

    if (this.phase === "running") {
      this.playerFireCooldown = Math.max(0, this.playerFireCooldown - delta);
      this.playerDashCooldown = Math.max(0, this.playerDashCooldown - delta);
      this.playerInvulnerability = Math.max(0, this.playerInvulnerability - delta);

      this.updateAimPoint();
      this.updatePlayer(delta);
      this.updateProjectiles(delta);
      this.updateEnemies(delta);
      this.updatePickups(delta);
      this.updateWaveFlow(delta);
    } else {
      this.updatePickups(delta);
    }

    this.updateCamera(delta);
    this.emitHud(false);
  }

  private updateEnvironment(delta: number): void {
    if (this.coreSpin) {
      this.coreSpin.rotation.y += delta * 1.25;
      this.coreSpin.position.y = Math.sin(this.time * 1.8) * 0.14;
    }

    if (this.arenaRing) {
      const ringMaterial = this.arenaRing.material as THREE.MeshStandardMaterial;
      ringMaterial.emissiveIntensity = 0.95 + Math.sin(this.time * 2.2) * 0.15;
    }

    if (this.playerEngineGlow) {
      const glowMaterial = this.playerEngineGlow.material as THREE.MeshStandardMaterial;
      const speedFactor = this.playerVelocity.length() / PLAYER_SPEED;
      glowMaterial.emissiveIntensity = 0.95 + speedFactor * 0.7 + (this.pointerDown ? 0.25 : 0);
      const scale = 1 + speedFactor * 0.08;
      this.playerEngineGlow.scale.set(scale, scale, scale);
    }
  }

  private updateAimPoint(): void {
    if (!this.isCoarsePointer) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const intersection = this.raycaster.ray.intersectPlane(this.groundPlane, this.tempA);
      if (intersection) {
        this.aimPoint.copy(intersection);
        this.aimPoint.y = PLAYER_HEIGHT;
        return;
      }
    }

    const nearestEnemy = this.findNearestEnemy();
    if (nearestEnemy) {
      this.aimPoint.copy(nearestEnemy.group.position);
      this.aimPoint.y = nearestEnemy.body.position.y;
      return;
    }

    this.aimPoint
      .copy(this.playerRoot.position)
      .add(this.tempA.set(Math.sin(this.playerHeading), 0, Math.cos(this.playerHeading)).multiplyScalar(12))
      .setY(PLAYER_HEIGHT);
  }

  private updatePlayer(delta: number): void {
    const moveX =
      (this.keys.has("KeyD") ? 1 : 0) -
      (this.keys.has("KeyA") ? 1 : 0) +
      (this.mobileState.right ? 1 : 0) -
      (this.mobileState.left ? 1 : 0);
    const moveY =
      (this.keys.has("KeyW") ? 1 : 0) -
      (this.keys.has("KeyS") ? 1 : 0) +
      (this.mobileState.up ? 1 : 0) -
      (this.mobileState.down ? 1 : 0);

    const cameraForward = this.tempA;
    this.camera.getWorldDirection(cameraForward);
    cameraForward.y = 0;
    if (cameraForward.lengthSq() < 0.0001) {
      cameraForward.set(0, 0, 1);
    }
    cameraForward.normalize();

    const cameraRight = this.tempB.set(0, 1, 0).cross(cameraForward).multiplyScalar(-1).normalize();
    const desiredVelocity = this.tempC.set(0, 0, 0);
    desiredVelocity.addScaledVector(cameraForward, moveY);
    desiredVelocity.addScaledVector(cameraRight, moveX);

    if (desiredVelocity.lengthSq() > 1) {
      desiredVelocity.normalize();
    }
    desiredVelocity.multiplyScalar(PLAYER_SPEED);

    const acceleration = 1 - Math.exp(-delta * 8.4);
    this.playerVelocity.lerp(desiredVelocity, acceleration);
    this.playerRoot.position.addScaledVector(this.playerVelocity, delta);
    this.clampToArena(this.playerRoot.position, 1.8);

    const facing = this.tempC.copy(this.aimPoint).sub(this.playerRoot.position);
    facing.y = 0;
    if (facing.lengthSq() < 0.01 && this.playerVelocity.lengthSq() > 0.1) {
      facing.copy(this.playerVelocity);
    }

    if (facing.lengthSq() > 0.01) {
      const targetHeading = Math.atan2(facing.x, facing.z);
      this.playerHeading = dampAngle(this.playerHeading, targetHeading, 10, delta);
      this.playerRoot.rotation.y = this.playerHeading;
    }

    const wantsToFire = this.pointerDown || this.keys.has("Space") || this.mobileState.fire;
    if (wantsToFire && this.playerFireCooldown <= 0) {
      this.spawnPlayerShot();
    }

    if (this.dashRequested && this.playerDashCooldown <= 0) {
      const dashVector = this.tempA.copy(this.playerVelocity);
      if (dashVector.lengthSq() < 0.12) {
        dashVector.set(Math.sin(this.playerHeading), 0, Math.cos(this.playerHeading));
      }
      dashVector.normalize();
      this.playerRoot.position.addScaledVector(dashVector, 4.2);
      this.playerVelocity.addScaledVector(dashVector, 14);
      this.playerDashCooldown = 2.3;
      this.playerInvulnerability = 0.34;
      this.clampToArena(this.playerRoot.position, 1.8);
      this.addBurst(this.playerRoot.position.clone().setY(1.2), 0x72f8ff, 1.08, 0.22);
    }

    this.dashRequested = false;
  }

  private updateCamera(delta: number): void {
    const forward = this.tempA.set(Math.sin(this.playerHeading), 0, Math.cos(this.playerHeading));
    const desiredPosition = this.tempB
      .copy(this.playerRoot.position)
      .addScaledVector(forward, -9.6)
      .add(new THREE.Vector3(0, 6.4, 0));

    const lerpAlpha = 1 - Math.exp(-delta * 4.5);
    this.camera.position.lerp(desiredPosition, lerpAlpha);

    this.cameraTarget
      .copy(this.playerRoot.position)
      .addScaledVector(forward, 6.4)
      .setY(1.6);
    this.camera.lookAt(this.cameraTarget);
  }

  private updateProjectiles(delta: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.life -= delta;
      projectile.mesh.position.addScaledVector(projectile.velocity, delta);

      if (
        projectile.life <= 0 ||
        Math.abs(projectile.mesh.position.x) > ARENA_RADIUS + 8 ||
        Math.abs(projectile.mesh.position.z) > ARENA_RADIUS + 8
      ) {
        this.removeProjectile(index);
        continue;
      }

      if (projectile.source === "player") {
        let didHit = false;
        for (let enemyIndex = this.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
          const enemy = this.enemies[enemyIndex];
          const distance = projectile.mesh.position.distanceTo(enemy.group.position);
          if (distance > enemy.radius + projectile.radius) {
            continue;
          }

          enemy.health -= projectile.damage;
          enemy.punch = 1;
          this.score += 16;
          this.addBurst(projectile.mesh.position.clone(), 0xffb27b, 0.42, 0.16);
          this.removeProjectile(index);
          didHit = true;

          if (enemy.health <= 0) {
            this.destroyEnemy(enemyIndex);
          }
          break;
        }

        if (didHit) {
          continue;
        }
      } else {
        const distanceToPlayer = projectile.mesh.position.distanceTo(this.playerRoot.position);
        if (distanceToPlayer <= 1.24 + projectile.radius) {
          this.applyPlayerDamage(projectile.damage);
          this.addBurst(projectile.mesh.position.clone(), 0xff9068, 0.56, 0.18);
          this.removeProjectile(index);
        }
      }
    }
  }

  private updateEnemies(delta: number): void {
    for (let index = this.enemies.length - 1; index >= 0; index -= 1) {
      const enemy = this.enemies[index];
      enemy.contactCooldown = Math.max(0, enemy.contactCooldown - delta);
      enemy.fireCooldown = Math.max(0, enemy.fireCooldown - delta);
      enemy.punch = Math.max(0, enemy.punch - delta * 4.5);

      enemy.body.position.y = 0.88 + Math.sin(this.time * 3.4 + enemy.hoverOffset) * 0.18;
      enemy.body.scale.setScalar(1 + enemy.punch * 0.09);

      if (enemy.rotor) {
        enemy.rotor.rotation.z += delta * (enemy.kind === "crusher" ? 0.7 : 2.6);
        enemy.rotor.rotation.y += delta * (enemy.kind === "spitter" ? 1.1 : 0.4);
      }

      const toPlayer = this.tempA.copy(this.playerRoot.position).sub(enemy.group.position);
      const distance = toPlayer.length();
      if (distance > 0.001) {
        toPlayer.normalize();
      }

      const orbit = this.tempB.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(enemy.orbitDirection);
      const desiredVelocity = this.tempC.set(0, 0, 0);

      if (enemy.kind === "scout") {
        desiredVelocity.addScaledVector(toPlayer, 1.08);
        desiredVelocity.addScaledVector(orbit, 0.28);
      }

      if (enemy.kind === "spitter") {
        const push = distance > 11 ? 0.95 : distance < 8.4 ? -0.72 : 0.08;
        desiredVelocity.addScaledVector(toPlayer, push);
        desiredVelocity.addScaledVector(orbit, 0.55);
        if (distance < 18 && enemy.fireCooldown <= 0) {
          this.spawnEnemyShot(enemy);
          enemy.fireCooldown = Math.max(0.8, 1.85 - this.wave * 0.05);
        }
      }

      if (enemy.kind === "crusher") {
        desiredVelocity.addScaledVector(toPlayer, 1.24);
        desiredVelocity.addScaledVector(orbit, 0.16);
      }

      if (desiredVelocity.lengthSq() > 1) {
        desiredVelocity.normalize();
      }
      desiredVelocity.multiplyScalar(enemy.speed);
      enemy.velocity.lerp(desiredVelocity, 1 - Math.exp(-delta * (enemy.kind === "crusher" ? 2.7 : 4.3)));
      enemy.group.position.addScaledVector(enemy.velocity, delta);
      this.clampToArena(enemy.group.position, enemy.kind === "crusher" ? 1.6 : 1.1);

      const facing = this.tempB.copy(this.playerRoot.position).sub(enemy.group.position);
      facing.y = 0;
      if (facing.lengthSq() > 0.01) {
        enemy.body.rotation.y = dampAngle(enemy.body.rotation.y, Math.atan2(facing.x, facing.z), 7.5, delta);
      }

      if (distance < enemy.radius + 1.1 && enemy.contactCooldown <= 0) {
        this.applyPlayerDamage(enemy.damage);
        this.playerVelocity.addScaledVector(toPlayer, 4.6);
        enemy.velocity.addScaledVector(toPlayer, -7.4);
        enemy.contactCooldown = enemy.kind === "crusher" ? 1.15 : 0.78;
      }
    }
  }

  private updatePickups(delta: number): void {
    for (let index = this.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = this.pickups[index];
      pickup.life -= delta;
      pickup.spin += delta * 2.8;
      pickup.mesh.rotation.y += delta * 2.5;
      pickup.mesh.rotation.x += delta * 1.2;
      pickup.mesh.position.y = 1.05 + Math.sin(this.time * 3.4 + pickup.spin) * 0.26;

      if (pickup.life <= 0) {
        this.dynamicRoot.remove(pickup.mesh);
        this.pickups.splice(index, 1);
        continue;
      }

      const distanceToPlayer = pickup.mesh.position.distanceTo(this.playerRoot.position);
      if (distanceToPlayer <= pickup.radius) {
        this.playerShield = clamp(this.playerShield + pickup.value, 0, PLAYER_MAX_SHIELD);
        this.score += 30;
        this.addBurst(pickup.mesh.position.clone(), 0xf7d26f, 0.64, 0.2);
        this.dynamicRoot.remove(pickup.mesh);
        this.pickups.splice(index, 1);
      }
    }
  }

  private updateBursts(delta: number): void {
    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index];
      burst.life -= delta;
      burst.mesh.scale.addScalar(delta * burst.growth);
      burst.material.opacity = Math.max(0, burst.life / burst.ttl) * 0.72;

      if (burst.life <= 0) {
        this.dynamicRoot.remove(burst.mesh);
        burst.material.dispose();
        this.bursts.splice(index, 1);
      }
    }
  }

  private updateWaveFlow(delta: number): void {
    if (this.spawnQueue.length > 0) {
      this.spawnCooldown -= delta;
      if (this.spawnCooldown <= 0) {
        const nextKind = this.spawnQueue.shift();
        if (nextKind) {
          this.spawnEnemy(nextKind);
          this.spawnCooldown = Math.max(0.28, 0.72 - this.wave * 0.03);
        }
      }
    }

    if (!this.waveCleared && this.spawnQueue.length === 0 && this.enemies.length === 0) {
      this.waveCleared = true;
      this.intermission = 2.4;
      this.score += 140 * this.wave;
      this.playerHealth = clamp(this.playerHealth + 10, 0, PLAYER_MAX_HEALTH);
      this.playerShield = clamp(this.playerShield + 16, 0, PLAYER_MAX_SHIELD);
      this.statusText = `Wave ${this.wave} đã bị quét sạch.`;
      this.statusTimer = 2.1;
      this.addBurst(new THREE.Vector3(0, 1.4, 0), 0x7bf3ff, 1.4, 0.25);
    }

    if (this.waveCleared) {
      this.intermission -= delta;
      if (this.intermission <= 0) {
        this.wave += 1;
        this.prepareWave(this.wave);
      }
    }
  }

  private prepareWave(wave: number): void {
    const queue: EnemyKind[] = [];

    for (let index = 0; index < 4 + wave * 2; index += 1) {
      queue.push("scout");
    }

    for (let index = 0; index < Math.max(0, wave - 1); index += 1) {
      queue.push("spitter");
    }

    for (let index = 0; index < Math.max(0, Math.floor((wave - 2) / 2)); index += 1) {
      queue.push("crusher");
    }

    this.spawnQueue = shuffle(queue);
    this.spawnCooldown = 0.5;
    this.waveCleared = false;
    this.intermission = -1;
    this.statusText = `Wave ${wave} đang tràn vào.`;
    this.statusTimer = 2.2;
  }

  private destroyEnemy(index: number): void {
    const enemy = this.enemies[index];
    const position = enemy.group.position.clone();
    position.y = enemy.body.position.y;

    this.score += enemy.score;
    this.addBurst(position.clone(), enemy.kind === "spitter" ? 0xff8f62 : 0xf9d08a, enemy.kind === "crusher" ? 1.1 : 0.82, 0.24);

    const dropChance = enemy.kind === "crusher" ? 1 : enemy.kind === "spitter" ? 0.58 : 0.34;
    if (Math.random() < dropChance) {
      this.spawnPickup(position, enemy.kind === "crusher" ? 22 : 14);
    }

    this.dynamicRoot.remove(enemy.group);
    this.disposeGroup(enemy.group);
    this.enemies.splice(index, 1);
  }

  private applyPlayerDamage(amount: number): void {
    if (this.playerInvulnerability > 0) {
      return;
    }

    let remaining = amount;
    if (this.playerShield > 0) {
      const absorbed = Math.min(this.playerShield, remaining);
      this.playerShield -= absorbed;
      remaining -= absorbed;
    }

    if (remaining > 0) {
      this.playerHealth = clamp(this.playerHealth - remaining, 0, PLAYER_MAX_HEALTH);
    }

    this.playerInvulnerability = 0.22;
    this.addBurst(this.playerRoot.position.clone().setY(1.18), 0xff9168, 0.78, 0.2);

    if (this.playerHealth <= 0) {
      this.phase = "gameover";
      this.pointerDown = false;
      this.mobileState.fire = false;
      this.statusText = "Thân tàu gãy vụn. Nạp lại chiến dịch.";
      this.statusTimer = 99;
      this.emitHud(true);
    }
  }

  private emitHud(force: boolean): void {
    if (!force && this.time - this.lastHudEmission < 0.08) {
      return;
    }

    this.lastHudEmission = this.time;
    const enemiesRemaining = this.enemies.length + this.spawnQueue.length;
    const snapshot: HudSnapshot = {
      phase: this.phase,
      title: "Orbital Reckoning",
      subtitle: "Game 3D sinh tồn trên trình duyệt, đủ sức đẩy thẳng lên Vercel.",
      health: Math.round(this.playerHealth),
      shield: Math.round(this.playerShield),
      score: Math.round(this.score),
      wave: this.wave,
      enemies: enemiesRemaining,
      dashReady: this.playerDashCooldown <= 0.05,
      statusText:
        this.statusTimer > 0
          ? this.statusText
          : this.phase === "ready"
            ? "Nhấn BẮT ĐẦU để thử vertical slice 3D."
            : this.phase === "gameover"
              ? "Run kết thúc. Chơi lại để thử wave cao hơn."
              : enemiesRemaining > 0
                ? "Giữ nhịp di chuyển và đừng để swarm kẹp góc."
                : "Đấu trường đang nạp wave mới.",
      objectiveText:
        this.phase === "ready"
          ? "WASD + chuột để điều khiển. Mobile có pad cảm ứng riêng."
          : this.phase === "gameover"
            ? "Ấn Chơi lại hoặc phím Enter để nạp lại trận."
            : "Bắn, dash, quét sạch từng wave rồi sống sót lâu nhất có thể."
    };

    this.callbacks.onHudChange(snapshot);
  }

  private clearDynamicState(): void {
    for (const enemy of this.enemies) {
      this.dynamicRoot.remove(enemy.group);
      this.disposeGroup(enemy.group);
    }

    for (const projectile of this.projectiles) {
      this.dynamicRoot.remove(projectile.mesh);
    }

    for (const pickup of this.pickups) {
      this.dynamicRoot.remove(pickup.mesh);
    }

    for (const burst of this.bursts) {
      this.dynamicRoot.remove(burst.mesh);
      burst.material.dispose();
    }

    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.bursts = [];
    this.spawnQueue = [];
  }

  private removeProjectile(index: number): void {
    this.dynamicRoot.remove(this.projectiles[index].mesh);
    this.projectiles.splice(index, 1);
  }

  private findNearestEnemy(): Enemy | null {
    let nearest: Enemy | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const enemy of this.enemies) {
      const distance = enemy.group.position.distanceToSquared(this.playerRoot.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = enemy;
      }
    }

    return nearest;
  }

  private clampToArena(position: THREE.Vector3, padding: number): void {
    const limit = ARENA_RADIUS - padding;
    const distance = Math.hypot(position.x, position.z);
    if (distance <= limit) {
      return;
    }

    const scale = limit / distance;
    position.x *= scale;
    position.z *= scale;
  }

  private addBurst(position: THREE.Vector3, color: number, scale: number, ttl: number): void {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const mesh = new THREE.Mesh(this.burstGeometry, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(scale);
    this.dynamicRoot.add(mesh);

    this.bursts.push({
      mesh,
      material,
      life: ttl,
      ttl,
      growth: scale * 7.6
    });
  }

  private createShadowDisc(radius: number, opacity: number): THREE.Mesh {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 24),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity,
        depthWrite: false
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    return shadow;
  }

  private createGroundTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext("2d");

    if (!context) {
      const fallback = new THREE.CanvasTexture(canvas);
      fallback.colorSpace = THREE.SRGBColorSpace;
      return fallback;
    }

    context.fillStyle = "#040814";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const gradient = context.createRadialGradient(512, 512, 90, 512, 512, 480);
    gradient.addColorStop(0, "rgba(20, 77, 118, 0.46)");
    gradient.addColorStop(0.55, "rgba(12, 24, 48, 0.6)");
    gradient.addColorStop(1, "rgba(3, 5, 10, 1)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.strokeStyle = "rgba(111, 232, 255, 0.12)";
    context.lineWidth = 2;
    for (let line = 0; line <= canvas.width; line += 64) {
      context.beginPath();
      context.moveTo(line, 0);
      context.lineTo(line, canvas.height);
      context.stroke();

      context.beginPath();
      context.moveTo(0, line);
      context.lineTo(canvas.width, line);
      context.stroke();
    }

    context.strokeStyle = "rgba(255, 151, 92, 0.18)";
    context.lineWidth = 3;
    for (let radius = 132; radius <= 456; radius += 112) {
      context.beginPath();
      context.arc(512, 512, radius, 0, Math.PI * 2);
      context.stroke();
    }

    for (let index = 0; index < 220; index += 1) {
      const alpha = randomBetween(0.06, 0.22);
      context.fillStyle = `rgba(126, 242, 255, ${alpha.toFixed(3)})`;
      const x = Math.floor(Math.random() * canvas.width);
      const y = Math.floor(Math.random() * canvas.height);
      context.fillRect(x, y, 2, 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5.5, 5.5);
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  private createStarField(): THREE.Points {
    const count = 900;
    const positions = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
      const radius = randomBetween(34, 76);
      const theta = randomBetween(0, Math.PI * 2);
      const phi = randomBetween(0, Math.PI);

      positions[index * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[index * 3 + 1] = Math.cos(phi) * radius * 0.62 + 16;
      positions[index * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xbbe9ff,
        size: 0.26,
        transparent: true,
        opacity: 0.92,
        sizeAttenuation: true
      })
    );
  }

  private resetPlayerPose(): void {
    this.playerRoot.position.set(0, 0, 0);
    this.playerVelocity.set(0, 0, 0);
    this.playerHeading = 0;
    this.playerRoot.rotation.set(0, 0, 0);
    this.aimPoint.set(0, PLAYER_HEIGHT, 12);
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      object.geometry.dispose();
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose());
      } else {
        object.material.dispose();
      }
    });
  }

  private animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.033);
    this.update(delta);
    this.renderer.render(this.scene, this.camera);
  };

  private bindEvents(): void {
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("pointerup", this.handleWindowPointerUp);
    window.addEventListener("blur", this.handleBlur);
    this.container.addEventListener("pointermove", this.handlePointerMove);
    this.container.addEventListener("pointerdown", this.handlePointerDown);
  }

  private unbindEvents(): void {
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("pointerup", this.handleWindowPointerUp);
    window.removeEventListener("blur", this.handleBlur);
    this.container.removeEventListener("pointermove", this.handlePointerMove);
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
  }

  private handleResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (
      [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "Space",
        "ShiftLeft",
        "ShiftRight",
        "KeyQ",
        "Enter",
        "KeyR"
      ].includes(event.code)
    ) {
      event.preventDefault();
    }

    this.keys.add(event.code);

    if ((event.code === "ShiftLeft" || event.code === "ShiftRight" || event.code === "KeyQ") && !event.repeat) {
      this.dashRequested = true;
    }

    if (event.code === "Enter" && this.phase !== "running") {
      this.startMission();
    }

    if (event.code === "KeyR" && this.phase === "gameover") {
      this.startMission();
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") {
      this.isCoarsePointer = false;
    }

    const rect = this.container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" || event.pointerType === "pen") {
      this.pointerDown = true;
    }
  };

  private handleWindowPointerUp = (): void => {
    this.pointerDown = false;
  };

  private handleBlur = (): void => {
    this.pointerDown = false;
    this.keys.clear();
    for (const key of Object.keys(this.mobileState) as VirtualKey[]) {
      this.mobileState[key] = false;
    }
  };
}
