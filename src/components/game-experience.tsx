"use client";

import { useEffect, useRef, useState } from "react";
import {
  OrbitalReckoningGame,
  type HudSnapshot,
  type VirtualKey
} from "@/game/orbital-reckoning";

const INITIAL_HUD: HudSnapshot = {
  phase: "ready",
  title: "Orbital Reckoning",
  subtitle: "Game 3D sinh tồn trên trình duyệt, đủ sức đẩy thẳng lên Vercel.",
  health: 100,
  shield: 60,
  score: 0,
  wave: 1,
  enemies: 0,
  dashReady: true,
  statusText: "Nhấn BẮT ĐẦU để thử vertical slice 3D.",
  objectiveText: "WASD + chuột để điều khiển. Mobile có pad cảm ứng riêng."
};

function Meter({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "hull" | "shield";
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

export function GameExperience() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<OrbitalReckoningGame | null>(null);
  const [hud, setHud] = useState(INITIAL_HUD);

  useEffect(() => {
    if (!stageRef.current) {
      return;
    }

    const game = new OrbitalReckoningGame(stageRef.current, {
      onHudChange: (snapshot) => setHud(snapshot)
    });
    gameRef.current = game;

    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const startMission = () => gameRef.current?.startMission();
  const triggerDash = () => gameRef.current?.triggerDash();

  const bindHold = (key: VirtualKey) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gameRef.current?.setVirtualKey(key, true);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      gameRef.current?.setVirtualKey(key, false);
    },
    onPointerCancel: () => gameRef.current?.setVirtualKey(key, false),
    onLostPointerCapture: () => gameRef.current?.setVirtualKey(key, false),
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault()
  });

  return (
    <div className="game-frame">
      <div ref={stageRef} className="game-stage" />

      <div className="hud-layer">
        <div className="hud-top">
          <section className="glass-panel hero-panel">
            <p className="eyebrow">3D web game / Next.js + Three.js</p>
            <h1>{hud.title}</h1>
            <p className="hero-copy">{hud.subtitle}</p>
            <p className="status-line">{hud.statusText}</p>
          </section>

          <section className="glass-panel stats-panel">
            <div className="stat-chip">
              <span>Wave</span>
              <strong>{hud.wave}</strong>
            </div>
            <div className="stat-chip">
              <span>Enemy</span>
              <strong>{hud.enemies}</strong>
            </div>
            <div className="stat-chip">
              <span>Score</span>
              <strong>{hud.score}</strong>
            </div>
            <div className={`stat-chip ${hud.dashReady ? "dash-ready" : "dash-cooldown"}`}>
              <span>Dash</span>
              <strong>{hud.dashReady ? "READY" : "COOLDOWN"}</strong>
            </div>
          </section>
        </div>

        <div className="hud-center">
          <div className="signal-pill">{hud.objectiveText}</div>
        </div>

        <div className="hud-bottom">
          <section className="glass-panel meter-panel">
            <Meter label="Hull" value={hud.health} tone="hull" />
            <Meter label="Shield" value={hud.shield} tone="shield" />
          </section>

          <section className="glass-panel controls-panel desktop-only">
            <p className="controls-title">Desktop controls</p>
            <p>WASD di chuyển</p>
            <p>Chuột để ngắm</p>
            <p>Giữ click trái hoặc Space để bắn</p>
            <p>Shift hoặc Q để dash</p>
          </section>
        </div>
      </div>

      {hud.phase !== "running" ? (
        <div className="overlay">
          <div className="overlay-card">
            <p className="overlay-tag">Deployable vertical slice</p>
            <h2>{hud.phase === "ready" ? "Sẵn sàng khai hỏa" : "Run đã thất bại"}</h2>
            <p className="overlay-copy">
              {hud.phase === "ready"
                ? "Mục tiêu là sống sót qua càng nhiều wave càng tốt. Bạn có movement, firing, dash, enemy AI, pickup giáp và nhịp tăng độ khó thực sự."
                : `Bạn dừng ở wave ${hud.wave} với ${hud.score} điểm. Nhấn chơi lại để nạp một run mới.`}
            </p>
            <ul className="overlay-list">
              <li>Desktop: WASD + chuột + giữ click để bắn + Shift để dash.</li>
              <li>Mobile: pad trái để di chuyển, FIRE để bắn, DASH để thoát kẹp.</li>
              <li>Mỗi wave dọn sạch swarm sẽ hồi chút hull và shield.</li>
            </ul>
            <button type="button" className="primary-button" onClick={startMission}>
              {hud.phase === "ready" ? "Bắt đầu run" : "Chơi lại ngay"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mobile-controls" aria-hidden="true">
        <div className="dpad">
          <span />
          <button type="button" className="touch-key" {...bindHold("up")}>
            ▲
          </button>
          <span />
          <button type="button" className="touch-key" {...bindHold("left")}>
            ◀
          </button>
          <button type="button" className="touch-key touch-key-center" onClick={triggerDash}>
            DASH
          </button>
          <button type="button" className="touch-key" {...bindHold("right")}>
            ▶
          </button>
          <span />
          <button type="button" className="touch-key" {...bindHold("down")}>
            ▼
          </button>
          <span />
        </div>

        <div className="action-cluster">
          <button type="button" className="touch-action fire-action" {...bindHold("fire")}>
            FIRE
          </button>
          <button type="button" className="touch-action dash-action" onClick={triggerDash}>
            DASH
          </button>
        </div>
      </div>
    </div>
  );
}
