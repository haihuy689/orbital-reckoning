import * as THREE from "three";

export type Phase = "ready" | "running" | "gameover";

export interface HudSnapshot {
  phase: Phase;
  title: string;
  subtitle: string;
  health: number;
  charge: number;
  score: number;
  wave: number;
  enemies: number;
  dashReady: boolean;
  pulseReady: boolean;
  dashCooldown: number;
  pulseCooldown: number;
  dashCost: number;
  pulseCost: number;
  statusText: string;
  objectiveText: string;
}

interface GameCallbacks {
  onHudChange: (snapshot: HudSnapshot) => void;
}

type EnemyKind = "shard" | "hexer" | "brute";
type ProjectileSource = "player" | "enemy";

interface Enemy {
  id: number;
  kind: EnemyKind;
  group: THREE.Group;
  body: THREE.Group;
  accent?: THREE.Object3D | null;
  velocity: THREE.Vector3;
  radius: number;
  speed: number;
  health: number;
  damage: number;
  score: number;
  fireCooldown: number;
  contactCooldown: number;
  hoverOffset: number;
  strafeDirection: number;
  hitFlash: number;
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
  health: number;
  charge: number;
  radius: number;
  life: number;
  spin: number;
}

interface Burst {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  ttl: number;
  growth: number;
}

const ARENA_RADIUS = 22;
const PLAYER_BASE_HEIGHT = 0.9;
const PLAYER_SPEED = 9.6;
const PLAYER_MAX_HEALTH = 100;
const PLAYER_MAX_CHARGE = 100;
const PLAYER_FIRE_RATE = 0.18;
const PLAYER_PROJECTILE_SPEED = 32;
const ENEMY_PROJECTILE_SPEED = 18;
const DASH_COST = 22;
const PULSE_COST = 55;

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

export class NebulaSurgeGame {
  private readonly container: HTMLElement;
  private readonly callbacks: GameCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly environment = new THREE.Group();
  private readonly dynamicRoot = new THREE.Group();
  private readonly playerRoot = new THREE.Group();
  private readonly playerVelocity = new THREE.Vector3();
  private readonly moveIntent = new THREE.Vector2();
  private readonly keyboard = new Set<string>();
  private readonly tempA = new THREE.Vector3();
  private readonly tempB = new THREE.Vector3();
  private readonly tempC = new THREE.Vector3();
  private readonly projectileGeometry = new THREE.SphereGeometry(0.17, 10, 10);
  private readonly burstGeometry = new THREE.SphereGeometry(0.42, 14, 14);
  private readonly pickupGeometry = new THREE.OctahedronGeometry(0.46, 0);
  private readonly playerShotMaterial = new THREE.MeshBasicMaterial({ color: 0x86f5ff });
  private readonly enemyShotMaterial = new THREE.MeshBasicMaterial({ color: 0xff9f78 });
  private readonly pickupMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd986,
    emissive: 0xff9d53,
    emissiveIntensity: 0.95,
    roughness: 0.28,
    metalness: 0.42
  });
  private readonly beaconMaterials: THREE.MeshBasicMaterial[] = [];

  private animationFrame = 0;
  private time = 0;
  private phase: Phase = "ready";
  private wave = 1;
  private score = 0;
  private playerHealth = PLAYER_MAX_HEALTH;
  private playerCharge = PLAYER_MAX_CHARGE;
  private playerHeading = 0;
  private autoFireCooldown = 0;
  private dashCooldown = 0;
  private pulseCooldown = 0;
  private playerInvulnerability = 0;
  private dashRequested = false;
  private pulseRequested = false;
  private statusText = "Keo pad trai de move. Vu khi se tu bat muc tieu gan nhat.";
  private statusTimer = 0;
  private spawnQueue: EnemyKind[] = [];
  private spawnCooldown = 0;
  private waveCleared = false;
  private intermission = -1;
  private lastHudEmission = -1;
  private nextEnemyId = 1;
  private isCoarsePointer = false;

  private playerBody: THREE.Group | null = null;
  private playerHalo: THREE.Mesh | null = null;
  private playerEngineGlow: THREE.Mesh | null = null;
  private playerHaloMaterial: THREE.MeshBasicMaterial | null = null;
  private playerGlowMaterial: THREE.MeshStandardMaterial | null = null;
  private arenaCore: THREE.Group | null = null;
  private arenaEdgeMaterial: THREE.MeshStandardMaterial | null = null;
  private arenaFloorGlow: THREE.MeshBasicMaterial | null = null;

  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private pickups: Pickup[] = [];
  private bursts: Burst[] = [];

  constructor(container: HTMLElement, callbacks: GameCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02060f);
    this.scene.fog = new THREE.Fog(0x02060f, 24, 74);

    this.camera = new THREE.PerspectiveCamera(54, 1, 0.1, 170);
    this.camera.position.set(0, 16, -13);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";

    this.container.appendChild(this.renderer.domElement);
    this.scene.add(this.environment);
    this.scene.add(this.dynamicRoot);
    this.scene.add(this.playerRoot);

    this.isCoarsePointer =
      window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(hover: none)").matches ||
      window.innerWidth < 900;

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

  startRun(): void {
    this.phase = "running";
    this.wave = 1;
    this.score = 0;
    this.playerHealth = PLAYER_MAX_HEALTH;
    this.playerCharge = PLAYER_MAX_CHARGE;
    this.playerHeading = 0;
    this.autoFireCooldown = 0;
    this.dashCooldown = 0;
    this.pulseCooldown = 0;
    this.playerInvulnerability = 0;
    this.dashRequested = false;
    this.pulseRequested = false;
    this.waveCleared = false;
    this.intermission = -1;
    this.statusText = "Wave 1 da vao tam bao.";
    this.statusTimer = 2.2;

    this.moveIntent.set(0, 0);
    this.keyboard.clear();
    this.resetPlayerPose();
    this.clearDynamicState();
    this.prepareWave(this.wave);
    this.emitHud(true);
  }

  setMoveIntent(x: number, y: number): void {
    const length = Math.hypot(x, y);
    if (length <= 1) {
      this.moveIntent.set(x, y);
      return;
    }

    this.moveIntent.set(x / length, y / length);
  }

  triggerDash(): void {
    this.dashRequested = true;
  }

  triggerPulse(): void {
    this.pulseRequested = true;
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.unbindEvents();
    this.clearDynamicState();
    this.renderer.dispose();

    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      object.geometry.dispose();
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => this.disposeMaterial(material));
      } else {
        this.disposeMaterial(object.material);
      }
    });

    this.playerShotMaterial.dispose();
    this.enemyShotMaterial.dispose();
    this.pickupMaterial.dispose();
    this.projectileGeometry.dispose();
    this.burstGeometry.dispose();
    this.pickupGeometry.dispose();

    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0x92c7ff, 0x170e09, 1.45);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2ca, 1.5);
    key.position.set(14, 20, 8);
    this.scene.add(key);

    const cyanGlow = new THREE.PointLight(0x5eeeff, 4.5, 28, 2);
    cyanGlow.position.set(0, 6.5, 0);
    this.scene.add(cyanGlow);

    const emberGlow = new THREE.PointLight(0xff986f, 2.6, 24, 2);
    emberGlow.position.set(0, 4, -8);
    this.scene.add(emberGlow);
  }

  private buildArena(): void {
    const groundTexture = this.createGroundTexture();
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS + 8, 96),
      new THREE.MeshStandardMaterial({
        map: groundTexture,
        color: 0x070d17,
        emissive: 0x060b14,
        emissiveIntensity: 0.85,
        roughness: 0.88,
        metalness: 0.2
      })
    );
    ground.rotation.x = -Math.PI / 2;
    this.environment.add(ground);

    this.arenaFloorGlow = new THREE.MeshBasicMaterial({
      color: 0x123d63,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const floorGlow = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS + 2.5, 64),
      this.arenaFloorGlow
    );
    floorGlow.rotation.x = -Math.PI / 2;
    floorGlow.position.y = 0.03;
    this.environment.add(floorGlow);

    const edgeBand = new THREE.Mesh(
      new THREE.RingGeometry(ARENA_RADIUS - 1.3, ARENA_RADIUS + 0.8, 96),
      new THREE.MeshBasicMaterial({
        color: 0x143350,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    edgeBand.rotation.x = -Math.PI / 2;
    edgeBand.position.y = 0.04;
    this.environment.add(edgeBand);

    this.arenaEdgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x78efff,
      emissive: 0x1c5368,
      emissiveIntensity: 0.95,
      roughness: 0.22,
      metalness: 0.76
    });
    const edgeRing = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA_RADIUS + 0.35, 0.36, 16, 96),
      this.arenaEdgeMaterial
    );
    edgeRing.rotation.x = Math.PI / 2;
    edgeRing.position.y = 0.6;
    this.environment.add(edgeRing);

    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      const x = Math.cos(angle) * (ARENA_RADIUS - 1.8);
      const z = Math.sin(angle) * (ARENA_RADIUS - 1.8);
      const height = randomBetween(2.6, 5.8);

      const pylon = new THREE.Mesh(
        new THREE.CylinderGeometry(randomBetween(0.45, 0.78), randomBetween(0.72, 1.02), height, 8),
        new THREE.MeshStandardMaterial({
          color: index % 2 === 0 ? 0x263145 : 0x3a2922,
          emissive: index % 2 === 0 ? 0x101b2d : 0x26120f,
          emissiveIntensity: 0.35,
          roughness: 0.74,
          metalness: 0.28
        })
      );
      pylon.position.set(x, height / 2, z);
      this.environment.add(pylon);

      const beaconMaterial = new THREE.MeshBasicMaterial({
        color: index % 2 === 0 ? 0x72efff : 0xffa176,
        transparent: true,
        opacity: 0.72
      });
      this.beaconMaterials.push(beaconMaterial);
      const beacon = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.08, 8, 22), beaconMaterial);
      beacon.rotation.x = Math.PI / 2;
      beacon.position.set(x, height + 0.24, z);
      this.environment.add(beacon);
    }

    this.arenaCore = new THREE.Group();
    const coreBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 2.5, 1.2, 10),
      new THREE.MeshStandardMaterial({
        color: 0x253149,
        emissive: 0x0d1725,
        emissiveIntensity: 0.55,
        roughness: 0.6,
        metalness: 0.56
      })
    );
    coreBase.position.y = 0.6;
    this.environment.add(coreBase);

    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.96, 0),
      new THREE.MeshStandardMaterial({
        color: 0x88f6ff,
        emissive: 0x38c7d8,
        emissiveIntensity: 1.3,
        roughness: 0.12,
        metalness: 0.18
      })
    );
    crystal.position.y = 2.05;
    this.arenaCore.add(crystal);

    const ringA = new THREE.Mesh(
      new THREE.TorusGeometry(1.8, 0.1, 10, 42),
      new THREE.MeshStandardMaterial({
        color: 0x74eeff,
        emissive: 0x225f74,
        emissiveIntensity: 0.92,
        roughness: 0.24,
        metalness: 0.68
      })
    );
    ringA.rotation.x = Math.PI / 2;
    ringA.position.y = 2.02;
    this.arenaCore.add(ringA);

    const ringB = new THREE.Mesh(
      new THREE.TorusGeometry(1.28, 0.08, 10, 28),
      new THREE.MeshStandardMaterial({
        color: 0xffc386,
        emissive: 0x7d4620,
        emissiveIntensity: 0.85,
        roughness: 0.28,
        metalness: 0.62
      })
    );
    ringB.rotation.set(Math.PI / 3, 0, Math.PI / 2.5);
    ringB.position.y = 2.02;
    this.arenaCore.add(ringB);

    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      const shard = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.9, 0.18),
        new THREE.MeshStandardMaterial({
          color: index % 2 === 0 ? 0x74eeff : 0xffb68a,
          emissive: index % 2 === 0 ? 0x204f63 : 0x6e3518,
          emissiveIntensity: 0.8,
          roughness: 0.18,
          metalness: 0.48
        })
      );
      shard.position.set(Math.cos(angle) * 2.5, 2.05, Math.sin(angle) * 2.5);
      shard.rotation.z = 0.35;
      this.arenaCore.add(shard);
    }

    this.environment.add(this.arenaCore);
    this.environment.add(this.createStarField());
  }

  private buildPlayer(): void {
    this.playerRoot.add(this.createShadowDisc(1.35, 0.3));

    this.playerBody = new THREE.Group();
    this.playerBody.position.y = PLAYER_BASE_HEIGHT;
    this.playerRoot.add(this.playerBody);

    const hullMaterial = new THREE.MeshStandardMaterial({
      color: 0xd0dae8,
      emissive: 0x182334,
      emissiveIntensity: 0.36,
      roughness: 0.22,
      metalness: 0.72
    });

    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.12, 0.64, 12), hullMaterial);
    this.playerBody.add(hull);

    const canopy = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.54, 0),
      new THREE.MeshStandardMaterial({
        color: 0xa8f7ff,
        emissive: 0x42c2d1,
        emissiveIntensity: 1.05,
        roughness: 0.14,
        metalness: 0.18
      })
    );
    canopy.position.set(0, 0.54, 0.1);
    this.playerBody.add(canopy);

    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.24, 1.6),
      new THREE.MeshStandardMaterial({
        color: 0xf2c888,
        emissive: 0x7d4520,
        emissiveIntensity: 0.76,
        roughness: 0.24,
        metalness: 0.52
      })
    );
    nose.position.set(0, 0.16, 0.98);
    this.playerBody.add(nose);

    const wingGeometry = new THREE.BoxGeometry(0.24, 0.24, 1.18);
    const wingMaterial = new THREE.MeshStandardMaterial({
      color: 0x344052,
      emissive: 0x121c2b,
      emissiveIntensity: 0.4,
      roughness: 0.54,
      metalness: 0.38
    });
    const wingLeft = new THREE.Mesh(wingGeometry, wingMaterial);
    wingLeft.position.set(-0.98, 0.08, -0.06);
    wingLeft.rotation.z = -0.25;
    this.playerBody.add(wingLeft);

    const wingRight = new THREE.Mesh(wingGeometry, wingMaterial);
    wingRight.position.set(0.98, 0.08, -0.06);
    wingRight.rotation.z = 0.25;
    this.playerBody.add(wingRight);

    this.playerGlowMaterial = new THREE.MeshStandardMaterial({
      color: 0xffcd8d,
      emissive: 0xff8140,
      emissiveIntensity: 1.1,
      roughness: 0.14,
      metalness: 0.3
    });
    this.playerEngineGlow = new THREE.Mesh(
      new THREE.TorusGeometry(0.54, 0.16, 10, 28),
      this.playerGlowMaterial
    );
    this.playerEngineGlow.rotation.x = Math.PI / 2;
    this.playerEngineGlow.position.set(0, 0.14, -0.86);
    this.playerBody.add(this.playerEngineGlow);

    this.playerHaloMaterial = new THREE.MeshBasicMaterial({
      color: 0x8df5ff,
      transparent: true,
      opacity: 0.54,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.playerHalo = new THREE.Mesh(
      new THREE.TorusGeometry(1.24, 0.09, 8, 40),
      this.playerHaloMaterial
    );
    this.playerHalo.rotation.x = Math.PI / 2;
    this.playerHalo.position.y = 0.12;
    this.playerBody.add(this.playerHalo);
  }

  private buildEnemy(kind: EnemyKind): Pick<Enemy, "group" | "body" | "accent"> {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(this.createShadowDisc(kind === "brute" ? 1.26 : 0.92, kind === "brute" ? 0.28 : 0.22));
    group.add(body);

    let accent: THREE.Object3D | null = null;

    if (kind === "shard") {
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.68, 0),
        new THREE.MeshStandardMaterial({
          color: 0xffbb84,
          emissive: 0xc75a22,
          emissiveIntensity: 0.82,
          roughness: 0.28,
          metalness: 0.52
        })
      );
      body.add(core);

      accent = new THREE.Mesh(
        new THREE.TorusGeometry(0.98, 0.08, 8, 26),
        new THREE.MeshStandardMaterial({
          color: 0xffd8ae,
          emissive: 0x6c3112,
          emissiveIntensity: 0.62,
          roughness: 0.2,
          metalness: 0.7
        })
      );
      accent.rotation.x = Math.PI / 2;
      body.add(accent);

      const strut = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.18, 0.28),
        new THREE.MeshStandardMaterial({
          color: 0x4a2f27,
          emissive: 0x24130d,
          emissiveIntensity: 0.34,
          roughness: 0.52,
          metalness: 0.38
        })
      );
      body.add(strut);
    }

    if (kind === "hexer") {
      const shell = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.82, 0),
        new THREE.MeshStandardMaterial({
          color: 0xff946f,
          emissive: 0x8e341f,
          emissiveIntensity: 0.96,
          roughness: 0.22,
          metalness: 0.42
        })
      );
      body.add(shell);

      const cannonMaterial = new THREE.MeshStandardMaterial({
        color: 0x492721,
        emissive: 0x23120d,
        emissiveIntensity: 0.34,
        roughness: 0.56,
        metalness: 0.28
      });
      const cannonLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.12, 10), cannonMaterial);
      cannonLeft.rotation.z = Math.PI / 2;
      cannonLeft.position.set(-0.76, 0, 0.08);
      body.add(cannonLeft);

      const cannonRight = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.12, 10), cannonMaterial);
      cannonRight.rotation.z = Math.PI / 2;
      cannonRight.position.set(0.76, 0, 0.08);
      body.add(cannonRight);

      accent = new THREE.Mesh(
        new THREE.TorusGeometry(0.9, 0.06, 8, 22),
        new THREE.MeshStandardMaterial({
          color: 0x74eeff,
          emissive: 0x22576f,
          emissiveIntensity: 0.82,
          roughness: 0.22,
          metalness: 0.64
        })
      );
      accent.rotation.set(Math.PI / 4, Math.PI / 4, 0);
      body.add(accent);
    }

    if (kind === "brute") {
      const shell = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.02, 0),
        new THREE.MeshStandardMaterial({
          color: 0xffc29d,
          emissive: 0x9b421f,
          emissiveIntensity: 0.82,
          roughness: 0.32,
          metalness: 0.42
        })
      );
      body.add(shell);

      const plateMaterial = new THREE.MeshStandardMaterial({
        color: 0x513733,
        emissive: 0x24110e,
        emissiveIntensity: 0.36,
        roughness: 0.66,
        metalness: 0.32
      });

      for (const direction of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.74, 1.5), plateMaterial);
        plate.position.set(direction * 1.02, 0, 0);
        plate.rotation.z = direction * 0.16;
        body.add(plate);
      }

      accent = new THREE.Mesh(
        new THREE.TorusGeometry(1.22, 0.1, 10, 28),
        new THREE.MeshStandardMaterial({
          color: 0xffdfb8,
          emissive: 0x6d3113,
          emissiveIntensity: 0.54,
          roughness: 0.16,
          metalness: 0.78
        })
      );
      accent.rotation.set(Math.PI / 2, 0, Math.PI / 4);
      body.add(accent);
    }

    return { group, body, accent };
  }

  private spawnEnemy(kind: EnemyKind): void {
    const angle = randomBetween(0, Math.PI * 2);
    const distance = randomBetween(ARENA_RADIUS - 1.4, ARENA_RADIUS - 0.6);
    const { group, body, accent } = this.buildEnemy(kind);
    group.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
    this.dynamicRoot.add(group);

    const stats =
      kind === "shard"
        ? {
            radius: 0.92,
            speed: 4.8 + this.wave * 0.12,
            health: 24 + this.wave * 2,
            damage: 10 + this.wave * 0.5,
            score: 90
          }
        : kind === "hexer"
          ? {
              radius: 1.02,
              speed: 3.4 + this.wave * 0.08,
              health: 42 + this.wave * 4,
              damage: 13 + this.wave * 0.6,
              score: 145
            }
          : {
              radius: 1.34,
              speed: 2.7 + this.wave * 0.06,
              health: 86 + this.wave * 7,
              damage: 22 + this.wave * 0.8,
              score: 240
            };

    this.enemies.push({
      id: this.nextEnemyId,
      kind,
      group,
      body,
      accent,
      velocity: new THREE.Vector3(),
      radius: stats.radius,
      speed: stats.speed,
      health: stats.health,
      damage: stats.damage,
      score: stats.score,
      fireCooldown: randomBetween(0.45, 1.1),
      contactCooldown: 0,
      hoverOffset: randomBetween(0, Math.PI * 2),
      strafeDirection: Math.random() < 0.5 ? -1 : 1,
      hitFlash: 0
    });
    this.nextEnemyId += 1;
  }

  private spawnPickup(position: THREE.Vector3, health: number, charge: number): void {
    const mesh = new THREE.Mesh(this.pickupGeometry, this.pickupMaterial);
    mesh.position.copy(position);
    mesh.position.y = 1.1;
    this.dynamicRoot.add(mesh);

    this.pickups.push({
      mesh,
      health,
      charge,
      radius: 1.2,
      life: 14,
      spin: randomBetween(0, Math.PI * 2)
    });
  }

  private spawnPlayerShot(enemy: Enemy): void {
    const projectile = new THREE.Mesh(this.projectileGeometry, this.playerShotMaterial);
    const start = this.playerRoot.position.clone().setY(1.08);
    projectile.position.copy(start);

    const lead = this.tempA.copy(enemy.group.position).addScaledVector(enemy.velocity, 0.18);
    lead.y = enemy.body.position.y + 0.46;
    const direction = this.tempB.copy(lead).sub(start).normalize();
    projectile.position.addScaledVector(direction, 1.08);
    this.dynamicRoot.add(projectile);

    this.projectiles.push({
      mesh: projectile,
      velocity: direction.clone().multiplyScalar(PLAYER_PROJECTILE_SPEED),
      life: 1.2,
      damage: 18,
      radius: 0.34,
      source: "player"
    });

    this.autoFireCooldown = PLAYER_FIRE_RATE;
    this.playerCharge = clamp(this.playerCharge + 2.4, 0, PLAYER_MAX_CHARGE);
    this.addBurst(projectile.position.clone(), 0x86f5ff, 0.28, 0.12);
  }

  private spawnEnemyShot(enemy: Enemy): void {
    const projectile = new THREE.Mesh(this.projectileGeometry, this.enemyShotMaterial);
    const start = enemy.group.position.clone();
    start.y = enemy.body.position.y + 0.18;
    projectile.position.copy(start);

    const lead = this.tempA.copy(this.playerRoot.position).addScaledVector(this.playerVelocity, 0.22);
    lead.y = 0.82;
    const direction = this.tempB.copy(lead).sub(start).normalize();
    projectile.position.addScaledVector(direction, 0.92);
    this.dynamicRoot.add(projectile);

    this.projectiles.push({
      mesh: projectile,
      velocity: direction.clone().multiplyScalar(ENEMY_PROJECTILE_SPEED),
      life: 1.8,
      damage: enemy.kind === "hexer" ? 11 + this.wave * 0.35 : 9 + this.wave * 0.25,
      radius: 0.38,
      source: "enemy"
    });

    this.addBurst(projectile.position.clone(), 0xff9f78, 0.24, 0.12);
  }

  private update(delta: number): void {
    this.time += delta;
    this.updateEnvironment(delta);
    this.updateCamera(delta);

    if (this.phase === "running") {
      this.autoFireCooldown = Math.max(0, this.autoFireCooldown - delta);
      this.dashCooldown = Math.max(0, this.dashCooldown - delta);
      this.pulseCooldown = Math.max(0, this.pulseCooldown - delta);
      this.playerInvulnerability = Math.max(0, this.playerInvulnerability - delta);
      this.playerCharge = clamp(this.playerCharge + delta * 9.5, 0, PLAYER_MAX_CHARGE);
      this.statusTimer = Math.max(0, this.statusTimer - delta);

      this.updatePlayer(delta);
      this.updateProjectiles(delta);
      this.updateEnemies(delta);
      this.updatePickups(delta);
      this.updateBursts(delta);
      this.updateWaveFlow(delta);
    } else {
      this.updateShowcase(delta);
    }

    this.emitHud(false);
  }

  private updateEnvironment(delta: number): void {
    if (this.arenaCore) {
      this.arenaCore.rotation.y += delta * 0.42;
      this.arenaCore.rotation.z = Math.sin(this.time * 0.8) * 0.08;
    }

    if (this.arenaEdgeMaterial) {
      this.arenaEdgeMaterial.emissiveIntensity = 0.88 + Math.sin(this.time * 2.2) * 0.16;
    }

    if (this.arenaFloorGlow) {
      this.arenaFloorGlow.opacity = 0.24 + (Math.sin(this.time * 1.6) * 0.5 + 0.5) * 0.08;
    }

    for (let index = 0; index < this.beaconMaterials.length; index += 1) {
      const material = this.beaconMaterials[index];
      material.opacity = 0.44 + (Math.sin(this.time * 2.8 + index * 0.6) * 0.5 + 0.5) * 0.36;
    }
  }

  private updateShowcase(delta: number): void {
    if (!this.playerBody) {
      return;
    }

    this.playerBody.position.y = PLAYER_BASE_HEIGHT + Math.sin(this.time * 3.2) * 0.08;
    this.playerBody.rotation.y += delta * 0.5;

    if (this.playerHalo) {
      const scale = 1 + (Math.sin(this.time * 2.4) * 0.5 + 0.5) * 0.08;
      this.playerHalo.scale.setScalar(scale);
    }
  }

  private updatePlayer(delta: number): void {
    if (!this.playerBody) {
      return;
    }

    let inputX = this.moveIntent.x;
    let inputY = this.moveIntent.y;

    if (this.keyboard.has("KeyA") || this.keyboard.has("ArrowLeft")) {
      inputX -= 1;
    }
    if (this.keyboard.has("KeyD") || this.keyboard.has("ArrowRight")) {
      inputX += 1;
    }
    if (this.keyboard.has("KeyW") || this.keyboard.has("ArrowUp")) {
      inputY += 1;
    }
    if (this.keyboard.has("KeyS") || this.keyboard.has("ArrowDown")) {
      inputY -= 1;
    }

    const inputLength = Math.hypot(inputX, inputY);
    if (inputLength > 1) {
      inputX /= inputLength;
      inputY /= inputLength;
    }

    const desiredVelocity = this.tempA.set(inputX * PLAYER_SPEED, 0, inputY * PLAYER_SPEED);
    this.playerVelocity.lerp(desiredVelocity, 1 - Math.exp(-delta * 10));
    this.playerRoot.position.addScaledVector(this.playerVelocity, delta);
    this.clampToArena(this.playerRoot.position, 1.25);

    if (inputLength > 0.12) {
      const targetHeading = Math.atan2(inputX, inputY);
      this.playerHeading = dampAngle(this.playerHeading, targetHeading, 12, delta);
    }

    this.playerBody.rotation.y = this.playerHeading;
    this.playerBody.position.y = PLAYER_BASE_HEIGHT + Math.sin(this.time * 7) * 0.08;
    this.playerBody.rotation.x = -this.playerVelocity.z * 0.012;
    this.playerBody.rotation.z = this.playerVelocity.x * -0.012;

    if (this.playerEngineGlow && this.playerGlowMaterial) {
      const speedRatio = Math.min(1, this.playerVelocity.length() / PLAYER_SPEED);
      this.playerEngineGlow.scale.setScalar(1 + speedRatio * 0.18 + (this.playerInvulnerability > 0 ? 0.12 : 0));
      this.playerGlowMaterial.emissiveIntensity = 1.05 + speedRatio * 0.58 + (this.playerInvulnerability > 0 ? 0.7 : 0);
    }

    if (this.playerHalo && this.playerHaloMaterial) {
      const haloScale =
        1 +
        (Math.sin(this.time * 10) * 0.5 + 0.5) * 0.06 +
        Math.min(1, this.playerVelocity.length() / PLAYER_SPEED) * 0.08;
      this.playerHalo.scale.setScalar(haloScale);
      this.playerHaloMaterial.opacity = 0.42 + (this.playerInvulnerability > 0 ? 0.2 : 0) + (this.phase === "running" ? 0.08 : 0);
    }

    if (this.dashRequested) {
      this.tryDash();
    }
    if (this.pulseRequested) {
      this.tryPulse();
    }

    const nearestEnemy = this.findNearestEnemy(18);
    if (nearestEnemy && this.autoFireCooldown <= 0) {
      this.spawnPlayerShot(nearestEnemy);
    }
  }

  private tryDash(): void {
    this.dashRequested = false;
    if (this.phase !== "running" || this.dashCooldown > 0 || this.playerCharge < DASH_COST) {
      return;
    }

    this.playerCharge = clamp(this.playerCharge - DASH_COST, 0, PLAYER_MAX_CHARGE);
    this.dashCooldown = 1.2;
    this.playerInvulnerability = 0.3;

    const direction = this.tempA.set(Math.sin(this.playerHeading), 0, Math.cos(this.playerHeading));
    if (this.moveIntent.lengthSq() > 0.08) {
      direction.set(this.moveIntent.x, 0, this.moveIntent.y).normalize();
    }

    this.playerVelocity.addScaledVector(direction, 20);
    this.playerRoot.position.addScaledVector(direction, 1.8);
    this.clampToArena(this.playerRoot.position, 1.25);
    this.statusText = "Dash lane da mo, tiep tuc cat goc.";
    this.statusTimer = 0.9;
    this.addBurst(this.playerRoot.position.clone().setY(1.0), 0x86f5ff, 0.9, 0.18);
  }

  private tryPulse(): void {
    this.pulseRequested = false;
    if (this.phase !== "running" || this.pulseCooldown > 0 || this.playerCharge < PULSE_COST) {
      return;
    }

    this.playerCharge = clamp(this.playerCharge - PULSE_COST, 0, PLAYER_MAX_CHARGE);
    this.pulseCooldown = 5.4;
    this.playerInvulnerability = Math.max(this.playerInvulnerability, 0.18);
    this.statusText = "Pulse da quet mot khoang trong xung quanh.";
    this.statusTimer = 1.1;

    const origin = this.playerRoot.position.clone();
    this.addBurst(origin.clone().setY(1.05), 0x72efff, 1.4, 0.24);
    this.addBurst(origin.clone().setY(0.2), 0xffb98b, 1.1, 0.2);

    for (let projectileIndex = this.projectiles.length - 1; projectileIndex >= 0; projectileIndex -= 1) {
      const projectile = this.projectiles[projectileIndex];
      if (projectile.source !== "enemy") {
        continue;
      }

      const distance = projectile.mesh.position.distanceTo(origin);
      if (distance <= 7) {
        this.addBurst(projectile.mesh.position.clone(), 0x72efff, 0.44, 0.14);
        this.removeProjectile(projectileIndex);
      }
    }

    for (let enemyIndex = this.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
      const enemy = this.enemies[enemyIndex];
      const distance = enemy.group.position.distanceTo(origin);
      if (distance > 7.4) {
        continue;
      }

      const force = 1 - distance / 7.4;
      enemy.health -= 34 + force * 22;
      enemy.hitFlash = 1;
      enemy.velocity.addScaledVector(this.tempA.copy(enemy.group.position).sub(origin).normalize(), 12 + force * 10);
      this.score += 20;
      if (enemy.health <= 0) {
        this.destroyEnemy(enemyIndex);
      }
    }
  }

  private updateProjectiles(delta: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.life -= delta;
      projectile.mesh.position.addScaledVector(projectile.velocity, delta);

      if (projectile.life <= 0 || projectile.mesh.position.length() > ARENA_RADIUS + 12) {
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
          enemy.hitFlash = 1;
          this.score += 8;
          this.playerCharge = clamp(this.playerCharge + 4, 0, PLAYER_MAX_CHARGE);
          this.addBurst(projectile.mesh.position.clone(), 0xffc089, 0.34, 0.12);
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
        if (distanceToPlayer <= 1.12 + projectile.radius) {
          this.applyPlayerDamage(projectile.damage);
          this.addBurst(projectile.mesh.position.clone(), 0xff9f78, 0.48, 0.16);
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
      enemy.hitFlash = Math.max(0, enemy.hitFlash - delta * 4.5);

      enemy.body.position.y = 0.82 + Math.sin(this.time * 3.4 + enemy.hoverOffset) * 0.18;
      enemy.body.scale.setScalar(1 + enemy.hitFlash * 0.1);

      if (enemy.accent) {
        enemy.accent.rotation.z += delta * (enemy.kind === "brute" ? 0.7 : 2.2);
        enemy.accent.rotation.y += delta * (enemy.kind === "hexer" ? 1.1 : 0.35);
      }

      const toPlayer = this.tempA.copy(this.playerRoot.position).sub(enemy.group.position);
      const distance = toPlayer.length();
      if (distance > 0.001) {
        toPlayer.normalize();
      }

      const orbit = this.tempB.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(enemy.strafeDirection);
      const desiredVelocity = this.tempC.set(0, 0, 0);

      if (enemy.kind === "shard") {
        desiredVelocity.addScaledVector(toPlayer, 1.14);
        desiredVelocity.addScaledVector(orbit, 0.32);
      }

      if (enemy.kind === "hexer") {
        const push = distance > 11.4 ? 0.92 : distance < 8.2 ? -0.74 : 0.06;
        desiredVelocity.addScaledVector(toPlayer, push);
        desiredVelocity.addScaledVector(orbit, 0.58);
        if (distance < 16 && enemy.fireCooldown <= 0) {
          this.spawnEnemyShot(enemy);
          enemy.fireCooldown = Math.max(0.9, 1.9 - this.wave * 0.04);
        }
      }

      if (enemy.kind === "brute") {
        desiredVelocity.addScaledVector(toPlayer, 1.22);
        desiredVelocity.addScaledVector(orbit, 0.12);
      }

      if (desiredVelocity.lengthSq() > 1) {
        desiredVelocity.normalize();
      }

      desiredVelocity.multiplyScalar(enemy.speed);
      enemy.velocity.lerp(desiredVelocity, 1 - Math.exp(-delta * (enemy.kind === "brute" ? 2.8 : 4.4)));
      enemy.group.position.addScaledVector(enemy.velocity, delta);
      this.clampToArena(enemy.group.position, enemy.radius + 0.8);

      const facing = this.tempB.copy(this.playerRoot.position).sub(enemy.group.position);
      facing.y = 0;
      if (facing.lengthSq() > 0.01) {
        enemy.body.rotation.y = dampAngle(enemy.body.rotation.y, Math.atan2(facing.x, facing.z), 7.8, delta);
      }

      if (distance < enemy.radius + 1.04 && enemy.contactCooldown <= 0) {
        this.applyPlayerDamage(enemy.damage);
        this.playerVelocity.addScaledVector(toPlayer, 4.8);
        enemy.velocity.addScaledVector(toPlayer, -6.8);
        enemy.contactCooldown = enemy.kind === "brute" ? 1.05 : 0.72;
      }
    }
  }

  private updatePickups(delta: number): void {
    for (let index = this.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = this.pickups[index];
      pickup.life -= delta;
      pickup.spin += delta * 2.6;
      pickup.mesh.rotation.y += delta * 2.4;
      pickup.mesh.rotation.x += delta * 1.2;
      pickup.mesh.position.y = 1.06 + Math.sin(this.time * 3.6 + pickup.spin) * 0.22;

      if (pickup.life <= 0) {
        this.dynamicRoot.remove(pickup.mesh);
        this.pickups.splice(index, 1);
        continue;
      }

      if (pickup.mesh.position.distanceTo(this.playerRoot.position) <= pickup.radius) {
        this.playerHealth = clamp(this.playerHealth + pickup.health, 0, PLAYER_MAX_HEALTH);
        this.playerCharge = clamp(this.playerCharge + pickup.charge, 0, PLAYER_MAX_CHARGE);
        this.score += 35;
        this.addBurst(pickup.mesh.position.clone(), 0xf8d67f, 0.58, 0.18);
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
          this.spawnCooldown = Math.max(0.26, 0.7 - this.wave * 0.03);
        }
      }
    }

    if (!this.waveCleared && this.spawnQueue.length === 0 && this.enemies.length === 0) {
      this.waveCleared = true;
      this.intermission = 2.4;
      this.score += 120 * this.wave;
      this.playerHealth = clamp(this.playerHealth + 12, 0, PLAYER_MAX_HEALTH);
      this.playerCharge = clamp(this.playerCharge + 28, 0, PLAYER_MAX_CHARGE);
      this.statusText = `Wave ${this.wave} da duoc don sach.`;
      this.statusTimer = 2.1;
      this.addBurst(new THREE.Vector3(0, 1.4, 0), 0x74eeff, 1.15, 0.24);
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
      queue.push("shard");
    }

    for (let index = 0; index < Math.max(1, Math.floor(wave / 2)); index += 1) {
      queue.push("hexer");
    }

    for (let index = 0; index < Math.max(0, Math.floor((wave - 1) / 3)); index += 1) {
      queue.push("brute");
    }

    this.spawnQueue = shuffle(queue);
    this.spawnCooldown = 0.45;
    this.waveCleared = false;
    this.intermission = -1;
    this.statusText = `Wave ${wave} dang tran vao tam dau.`;
    this.statusTimer = 2.2;
  }

  private destroyEnemy(index: number): void {
    const enemy = this.enemies[index];
    const position = enemy.group.position.clone();
    position.y = enemy.body.position.y;

    this.score += enemy.score;
    this.playerCharge = clamp(this.playerCharge + (enemy.kind === "brute" ? 12 : 7), 0, PLAYER_MAX_CHARGE);
    this.addBurst(position.clone(), enemy.kind === "hexer" ? 0xff9f78 : 0xffcb96, enemy.kind === "brute" ? 1.08 : 0.78, 0.2);

    const dropChance = enemy.kind === "brute" ? 1 : enemy.kind === "hexer" ? 0.56 : 0.3;
    if (Math.random() < dropChance) {
      this.spawnPickup(position, enemy.kind === "brute" ? 18 : 10, enemy.kind === "brute" ? 24 : 16);
    }

    this.dynamicRoot.remove(enemy.group);
    this.disposeGroup(enemy.group);
    this.enemies.splice(index, 1);
  }

  private applyPlayerDamage(amount: number): void {
    if (this.playerInvulnerability > 0) {
      return;
    }

    this.playerHealth = clamp(this.playerHealth - amount, 0, PLAYER_MAX_HEALTH);
    this.playerInvulnerability = 0.3;
    this.addBurst(this.playerRoot.position.clone().setY(1.08), 0xff9f78, 0.72, 0.18);

    if (this.playerHealth <= 0) {
      this.phase = "gameover";
      this.keyboard.clear();
      this.moveIntent.set(0, 0);
      this.statusText = "Core overload. Khoi dong lai run moi.";
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
    const dashReady = this.dashCooldown <= 0.05 && this.playerCharge >= DASH_COST;
    const pulseReady = this.pulseCooldown <= 0.05 && this.playerCharge >= PULSE_COST;

    this.callbacks.onHudChange({
      phase: this.phase,
      title: "Nebula Surge",
      subtitle: "Mobile-first 3D survival run tuned for smooth phone play.",
      health: Math.round(this.playerHealth),
      charge: Math.round(this.playerCharge),
      score: Math.round(this.score),
      wave: this.wave,
      enemies: enemiesRemaining,
      dashReady,
      pulseReady,
      dashCooldown: Math.max(0, this.dashCooldown),
      pulseCooldown: Math.max(0, this.pulseCooldown),
      dashCost: DASH_COST,
      pulseCost: PULSE_COST,
      statusText:
        this.statusTimer > 0
          ? this.statusText
          : this.phase === "ready"
            ? "Keo pad trai de move. Vu khi se tu bat muc tieu gan nhat."
            : this.phase === "gameover"
              ? "Run da dung. Bat dau lai de vuot qua wave cao hon."
              : enemiesRemaining > 0
                ? "Giu quang cach, cat goc bang Dash va dung Pulse khi swarm ap sat."
                : "Tam bao dang nap wave moi.",
      objectiveText:
        this.phase === "ready"
          ? "Song sot qua tung wave, dung Dash de cat goc va Pulse de clear swarm."
          : this.phase === "gameover"
            ? "Tap Play Again hoac Enter de mo run moi."
            : "Auto-fire luon bam muc tieu gan nhat. Flux charge giup Dash va Pulse san sang."
    });
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

  private findNearestEnemy(maxDistance: number): Enemy | null {
    let nearest: Enemy | null = null;
    let bestDistance = maxDistance * maxDistance;

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
      opacity: 0.72,
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
      growth: scale * 7.2
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
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    context.fillStyle = "#02060f";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const radial = context.createRadialGradient(512, 512, 90, 512, 512, 470);
    radial.addColorStop(0, "rgba(24, 92, 134, 0.48)");
    radial.addColorStop(0.48, "rgba(9, 18, 32, 0.72)");
    radial.addColorStop(1, "rgba(2, 6, 12, 1)");
    context.fillStyle = radial;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.strokeStyle = "rgba(118, 238, 255, 0.1)";
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

    context.strokeStyle = "rgba(255, 155, 110, 0.15)";
    context.lineWidth = 3;
    for (let radius = 136; radius <= 460; radius += 108) {
      context.beginPath();
      context.arc(512, 512, radius, 0, Math.PI * 2);
      context.stroke();
    }

    context.strokeStyle = "rgba(118, 238, 255, 0.08)";
    context.lineWidth = 1.5;
    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2;
      context.beginPath();
      context.moveTo(512, 512);
      context.lineTo(512 + Math.cos(angle) * 420, 512 + Math.sin(angle) * 420);
      context.stroke();
    }

    for (let index = 0; index < 240; index += 1) {
      const alpha = randomBetween(0.05, 0.18);
      context.fillStyle = `rgba(126, 242, 255, ${alpha.toFixed(3)})`;
      const x = Math.floor(Math.random() * canvas.width);
      const y = Math.floor(Math.random() * canvas.height);
      context.fillRect(x, y, 2, 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4.4, 4.4);
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  private createStarField(): THREE.Points {
    const count = 780;
    const positions = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
      const radius = randomBetween(32, 72);
      const theta = randomBetween(0, Math.PI * 2);
      const phi = randomBetween(0, Math.PI);
      positions[index * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[index * 3 + 1] = Math.cos(phi) * radius * 0.56 + 17;
      positions[index * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xbfeaff,
        size: 0.24,
        transparent: true,
        opacity: 0.9,
        sizeAttenuation: true
      })
    );
  }

  private resetPlayerPose(): void {
    this.playerRoot.position.set(0, 0, 0);
    this.playerVelocity.set(0, 0, 0);
    this.playerHeading = 0;
    if (this.playerBody) {
      this.playerBody.position.y = PLAYER_BASE_HEIGHT;
      this.playerBody.rotation.set(0, 0, 0);
    }
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      object.geometry.dispose();
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => this.disposeMaterial(material));
      } else {
        this.disposeMaterial(object.material);
      }
    });
  }

  private disposeMaterial(material: THREE.Material): void {
    const withMap = material as THREE.Material & { map?: THREE.Texture | null };
    withMap.map?.dispose();
    material.dispose();
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
    window.addEventListener("blur", this.handleBlur);
  }

  private unbindEvents(): void {
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
  }

  private updateCamera(delta: number): void {
    const desiredPosition = this.tempA.copy(this.playerRoot.position).add(new THREE.Vector3(0, 16, -13));
    this.camera.position.lerp(desiredPosition, 1 - Math.exp(-delta * 4.6));

    const lookTarget = this.tempB.copy(this.playerRoot.position).add(new THREE.Vector3(0, 1.4, 2.2));
    this.camera.lookAt(lookTarget.x, lookTarget.y, lookTarget.z);
  }

  private handleResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isCoarsePointer ? 1.5 : 1.8));
    this.renderer.setSize(width, height, false);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (
      [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "ShiftLeft",
        "ShiftRight",
        "KeyQ",
        "Space",
        "Enter",
        "KeyR"
      ].includes(event.code)
    ) {
      event.preventDefault();
    }

    this.keyboard.add(event.code);

    if ((event.code === "ShiftLeft" || event.code === "ShiftRight" || event.code === "KeyQ") && !event.repeat) {
      this.dashRequested = true;
    }

    if (event.code === "Space" && !event.repeat) {
      this.pulseRequested = true;
    }

    if (event.code === "Enter" && this.phase !== "running") {
      this.startRun();
    }

    if (event.code === "KeyR" && this.phase === "gameover") {
      this.startRun();
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keyboard.delete(event.code);
  };

  private handleBlur = (): void => {
    this.keyboard.clear();
    this.moveIntent.set(0, 0);
  };
}
