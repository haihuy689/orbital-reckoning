"use client";

import { useEffect, useRef, useState } from "react";
import { NebulaSurgeGame, type HudSnapshot } from "@/game/nebula-surge";

const INITIAL_HUD: HudSnapshot = {
  phase: "ready",
  title: "Nebula Surge",
  subtitle: "Mobile-first 3D survival run tuned for smooth phone play.",
  health: 100,
  charge: 100,
  score: 0,
  wave: 1,
  enemies: 0,
  dashReady: true,
  pulseReady: true,
  dashCooldown: 0,
  pulseCooldown: 0,
  dashCost: 22,
  pulseCost: 55,
  statusText: "Keo pad trai de move. Vu khi se tu bat muc tieu gan nhat.",
  objectiveText: "Song sot qua tung wave, dung Dash de cat goc va Pulse de clear swarm."
};

const STICK_LIMIT = 52;

function formatCooldown(value: number): string {
  return value <= 0.05 ? "READY" : `${value.toFixed(1)}s`;
}

function Meter({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "hull" | "charge";
}) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="meter-track">
        <div className={`meter-fill ${tone}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function NebulaExperience() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const movePadRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const dragOriginRef = useRef({ x: 0, y: 0 });
  const gameRef = useRef<NebulaSurgeGame | null>(null);
  const [hud, setHud] = useState(INITIAL_HUD);

  useEffect(() => {
    if (!stageRef.current) {
      return;
    }

    const game = new NebulaSurgeGame(stageRef.current, {
      onHudChange: (snapshot) => setHud(snapshot)
    });
    gameRef.current = game;

    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const setThumbPosition = (x: number, y: number) => {
    if (!thumbRef.current) {
      return;
    }

    thumbRef.current.style.transform = `translate(${x}px, ${y}px)`;
  };

  const releaseMovePad = () => {
    activePointerIdRef.current = null;
    movePadRef.current?.classList.remove("active");
    setThumbPosition(0, 0);
    gameRef.current?.setMoveIntent(0, 0);
  };

  const updateMovePad = (clientX: number, clientY: number) => {
    const dx = clientX - dragOriginRef.current.x;
    const dy = clientY - dragOriginRef.current.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > STICK_LIMIT ? STICK_LIMIT / distance : 1;
    const clampedX = dx * scale;
    const clampedY = dy * scale;

    setThumbPosition(clampedX, clampedY);
    gameRef.current?.setMoveIntent(clampedX / STICK_LIMIT, -clampedY / STICK_LIMIT);
  };

  const handlePadPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (activePointerIdRef.current !== null) {
      return;
    }

    activePointerIdRef.current = event.pointerId;
    dragOriginRef.current = { x: event.clientX, y: event.clientY };
    movePadRef.current?.classList.add("active");
    event.currentTarget.setPointerCapture(event.pointerId);
    setThumbPosition(0, 0);
    gameRef.current?.setMoveIntent(0, 0);
  };

  const handlePadPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerIdRef.current) {
      return;
    }

    event.preventDefault();
    updateMovePad(event.clientX, event.clientY);
  };

  const handlePadPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerIdRef.current) {
      return;
    }

    event.preventDefault();
    releaseMovePad();
  };

  const triggerDash = (event?: React.PointerEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    gameRef.current?.triggerDash();
  };

  const triggerPulse = (event?: React.PointerEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    gameRef.current?.triggerPulse();
  };

  const startRun = () => gameRef.current?.startRun();

  return (
    <div className="game-frame nebula-frame">
      <div ref={stageRef} className="game-stage" />

      <div className="interface-layer nebula-ui">
        <div className="top-strip">
          <section className="panel brand-card">
            <p className="overline">Mobile-First 3D Arena Run</p>
            <h1>{hud.title}</h1>
            <p className="subtitle">{hud.subtitle}</p>
            <p className="status-line">{hud.statusText}</p>
          </section>

          <section className="panel stat-grid" aria-label="Run stats">
            <div className="stat-card">
              <span>Wave</span>
              <strong>{hud.wave}</strong>
            </div>
            <div className="stat-card">
              <span>Enemies</span>
              <strong>{hud.enemies}</strong>
            </div>
            <div className="stat-card">
              <span>Score</span>
              <strong>{hud.score}</strong>
            </div>
            <div className="stat-card">
              <span>Charge</span>
              <strong>{hud.charge}%</strong>
            </div>
          </section>
        </div>

        <div className="message-row">
          <div className="message-pill">{hud.objectiveText}</div>
        </div>

        <div className="bottom-strip">
          <section className="panel meter-card">
            <Meter label="Hull" value={hud.health} tone="hull" />
            <Meter label="Core" value={hud.charge} tone="charge" />
            <p className="desktop-note">Desktop test: WASD move, Shift dash, Space pulse.</p>
          </section>

          <section className="control-shell" aria-label="Touch controls">
            <div
              ref={movePadRef}
              className="move-pad"
              onPointerDown={handlePadPointerDown}
              onPointerMove={handlePadPointerMove}
              onPointerUp={handlePadPointerUp}
              onPointerCancel={handlePadPointerUp}
              onLostPointerCapture={releaseMovePad}
            >
              <div className="move-base" />
              <div ref={thumbRef} className="move-thumb" />
              <p className="move-caption">DRIFT</p>
            </div>

            <div className="skill-stack">
              <button
                type="button"
                className={`skill-button dash-button ${hud.dashReady ? "ready" : "waiting"}`}
                onPointerDown={triggerDash}
              >
                <span className="skill-name">Dash</span>
                <strong>{formatCooldown(hud.dashCooldown)}</strong>
                <small>{hud.dashCost} charge</small>
              </button>

              <button
                type="button"
                className={`skill-button pulse-button ${hud.pulseReady ? "ready" : "waiting"}`}
                onPointerDown={triggerPulse}
              >
                <span className="skill-name">Pulse</span>
                <strong>{formatCooldown(hud.pulseCooldown)}</strong>
                <small>{hud.pulseCost} charge</small>
              </button>
            </div>
          </section>
        </div>
      </div>

      {hud.phase !== "running" ? (
        <div className="overlay">
          <div className="overlay-card">
            <p className="overlay-tag">Smooth Phone-First 3D</p>
            <h2>{hud.phase === "ready" ? "Ready to enter the rift?" : "Run collapsed"}</h2>
            <p className="overlay-copy">
              {hud.phase === "ready"
                ? "Keo ngon tay o pad trai de move. Auto-fire se tu bat muc tieu, Dash giup cat goc, Pulse giup quet swarm trong tam gan."
                : `Ban dung o wave ${hud.wave} voi ${hud.score} diem. Bat dau run moi de day xa hon vao tam bao.`}
            </p>
            <ul className="overlay-list">
              <li>Control cuc gon cho mobile: 1 pad trai va 2 nut ky nang lon.</li>
              <li>Core charge hoi dan theo thoi gian va tang them khi ha muc tieu.</li>
              <li>Moi wave dep hon, dong hon va doi giu nhat la giu duoc nhip di chuyen.</li>
            </ul>
            <button type="button" className="primary-button" onClick={startRun}>
              {hud.phase === "ready" ? "Start Run" : "Play Again"}
            </button>
            <p className="secondary-line">Desktop van co the test bang ban phim neu can.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
