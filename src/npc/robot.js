import * as THREE from 'three';

/**
 * Boxy robot citizen: hovering chassis, screen face that emotes, and a floating
 * dialogue billboard that reveals itself a word at a time.
 *
 *   const bot = new Robot({ name: 'Lampy', position, color: 0xffd23f });
 *   scene.add(bot.group);
 *   bot.say('Oh! A dog.', 4);
 *   bot.setEmote('happy');
 *   bot.update(dt, dogPosition);
 *
 * Faces and dialogue are canvas textures — no external assets, and redraws only
 * happen when the emote or the revealed word count actually changes.
 */

const FACE_SIZE = 128;
const NOTICE_RANGE = 9;
const WORD_INTERVAL = 0.075;

const BODY_MAT = () => new THREE.MeshStandardMaterial({ color: 0x39405c, roughness: 0.55, metalness: 0.45, flatShading: true });
const TRIM_MAT = () => new THREE.MeshStandardMaterial({ color: 0x232a41, roughness: 0.7, metalness: 0.35, flatShading: true });

// ---------------------------------------------------------------------------
// Screen face
// ---------------------------------------------------------------------------

const EMOTES = ['neutral', 'happy', 'sad', 'alert', 'question', 'heart', 'sleep'];

function drawFace(ctx, emote, color) {
  const S = FACE_SIZE;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, S, S);

  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';

  const eyeY = 50;
  const eyeDX = 27;

  const dots = () => {
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(S / 2 + sx * eyeDX, eyeY, 11, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  switch (emote) {
    case 'happy':
      // ^ ^ eyes over a wide grin
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(S / 2 + sx * eyeDX - 13, eyeY + 8);
        ctx.lineTo(S / 2 + sx * eyeDX, eyeY - 9);
        ctx.lineTo(S / 2 + sx * eyeDX + 13, eyeY + 8);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(S / 2, 78, 22, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      break;
    case 'sad':
      dots();
      ctx.beginPath();
      ctx.arc(S / 2, 104, 22, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
      break;
    case 'alert':
      ctx.beginPath();
      ctx.moveTo(S / 2, 26);
      ctx.lineTo(S / 2, 78);
      ctx.lineWidth = 16;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(S / 2, 102, 9, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'question':
      ctx.font = 'bold 92px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', S / 2, S / 2 + 4);
      break;
    case 'heart':
      ctx.beginPath();
      ctx.moveTo(S / 2, 96);
      ctx.bezierCurveTo(6, 62, 26, 22, S / 2, 48);
      ctx.bezierCurveTo(S - 26, 22, S - 6, 62, S / 2, 96);
      ctx.fill();
      break;
    case 'sleep':
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(S / 2 + sx * eyeDX - 13, eyeY);
        ctx.lineTo(S / 2 + sx * eyeDX + 13, eyeY);
        ctx.stroke();
      }
      ctx.font = 'bold 40px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('z', S / 2 + 34, 96);
      break;
    default:
      dots();
      ctx.beginPath();
      ctx.moveTo(S / 2 - 18, 92);
      ctx.lineTo(S / 2 + 18, 92);
      ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Dialogue billboard
// ---------------------------------------------------------------------------

const BUBBLE_W = 512;
const BUBBLE_H = 168;

function drawBubble(ctx, speaker, text, accent) {
  ctx.clearRect(0, 0, BUBBLE_W, BUBBLE_H);
  if (!text) return;

  ctx.fillStyle = 'rgba(6, 9, 18, 0.82)';
  roundRect(ctx, 6, 6, BUBBLE_W - 12, BUBBLE_H - 12, 18);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(speaker, 26, 20);

  ctx.fillStyle = '#e9eefc';
  ctx.font = '30px system-ui, sans-serif';
  const lines = wrap(ctx, text, BUBBLE_W - 52);
  for (let i = 0; i < lines.length && i < 3; i++) {
    ctx.fillText(lines[i], 26, 58 + i * 36);
  }
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Robot
// ---------------------------------------------------------------------------

export class Robot {
  constructor({
    name = 'Robot',
    position = new THREE.Vector3(),
    color = 0x22e0ff,
    yaw = 0,
    height = 1.5,
    colliders = null,
  } = {}) {
    this.name = name;
    this.color = color;
    this.colorCss = `#${new THREE.Color(color).getHexString()}`;
    this.position = position.clone();
    this.restYaw = yaw;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = yaw;

    this._buildBody(height, color);
    this._buildFace();
    this._buildBubble(height);

    this.emote = 'neutral';
    this.setEmote('neutral');

    this._t = Math.random() * 10;
    this._baseY = position.y;
    this._words = [];
    this._revealed = 0;
    this._wordTimer = 0;
    this._sayTimer = 0;
    this.speaking = false;
    this.nearDog = false;

    this._v = new THREE.Vector3();

    if (colliders) {
      const half = 0.4;
      colliders.push(new THREE.Box3(
        new THREE.Vector3(position.x - half, position.y, position.z - half),
        new THREE.Vector3(position.x + half, position.y + height, position.z + half),
      ));
    }
  }

  _buildBody(height, color) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, height * 0.5, 0.5), BODY_MAT());
    body.position.y = height * 0.42;
    body.castShadow = true;
    this.group.add(body);
    this.body = body;

    // Tapered skirt instead of legs — these things hover.
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.42, height * 0.34, 6), TRIM_MAT());
    skirt.position.y = height * 0.17;
    skirt.castShadow = true;
    this.group.add(skirt);

    const head = new THREE.Group();
    head.position.y = height * 0.78;
    this.group.add(head);
    this.head = head;

    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.5, 0.42), BODY_MAT());
    skull.castShadow = true;
    head.add(skull);

    // Arms: stubby boxes on a shoulder pivot so they can swing while talking.
    this.arms = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.42, height * 0.55, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.14), TRIM_MAT());
      arm.position.y = -0.21;
      pivot.add(arm);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.18), BODY_MAT());
      hand.position.y = -0.46;
      pivot.add(hand);
      pivot.rotation.z = sx * 0.12;
      this.group.add(pivot);
      this.arms.push(pivot);
    }

    // Antenna with a pulsing tip — the only light source on the model.
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), TRIM_MAT());
    stalk.position.y = 0.4;
    head.add(stalk);
    this.tipMaterial = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), this.tipMaterial);
    tip.position.y = 0.56;
    head.add(tip);

    this.glow = new THREE.PointLight(color, 6, 7, 2);
    this.glow.position.set(0, height * 0.8, 0.5);
    this.group.add(this.glow);
  }

  _buildFace() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = FACE_SIZE;
    this._faceCtx = canvas.getContext('2d');
    this._faceTexture = new THREE.CanvasTexture(canvas);
    this._faceTexture.colorSpace = THREE.SRGBColorSpace;

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.38),
      new THREE.MeshBasicMaterial({ map: this._faceTexture, toneMapped: false }),
    );
    screen.position.set(0, 0.02, -0.22);
    screen.rotation.y = Math.PI;   // the model's front is -Z, like the dog's
    this.head.add(screen);
  }

  _buildBubble(height) {
    const canvas = document.createElement('canvas');
    canvas.width = BUBBLE_W;
    canvas.height = BUBBLE_H;
    this._bubbleCtx = canvas.getContext('2d');
    this._bubbleTexture = new THREE.CanvasTexture(canvas);
    this._bubbleTexture.colorSpace = THREE.SRGBColorSpace;

    this._bubbleMaterial = new THREE.SpriteMaterial({
      map: this._bubbleTexture,
      transparent: true,
      depthTest: false,
      toneMapped: false,
      opacity: 0,
    });
    this.bubble = new THREE.Sprite(this._bubbleMaterial);
    this.bubble.scale.set(2.9, 0.95, 1);
    this.bubble.position.y = height + 0.95;
    this.bubble.renderOrder = 10;
    this.bubble.visible = false;
    this.group.add(this.bubble);
  }

  // -------------------------------------------------------------------------

  setEmote(emote) {
    const next = EMOTES.includes(emote) ? emote : 'neutral';
    if (next === this.emote && this._faceDrawn) return this;
    this.emote = next;
    this._faceDrawn = true;
    drawFace(this._faceCtx, next, this.colorCss);
    this._faceTexture.needsUpdate = true;
    return this;
  }

  /** Show a line above the robot's head, revealed word by word. */
  say(text, duration = 4.5, emote = null) {
    this._words = String(text).split(/\s+/).filter(Boolean);
    this._revealed = 0;
    this._wordTimer = 0;
    this._sayTimer = duration + this._words.length * WORD_INTERVAL;
    this.speaking = true;
    this.bubble.visible = true;
    if (emote) this.setEmote(emote);
    this._redrawBubble();
    return this;
  }

  hush() {
    this.speaking = false;
    this._words = [];
    this._sayTimer = 0;
    return this;
  }

  _redrawBubble() {
    drawBubble(this._bubbleCtx, this.name, this._words.slice(0, this._revealed).join(' '), this.colorCss);
    this._bubbleTexture.needsUpdate = true;
  }

  update(dt, dogPosition) {
    this._t += dt;

    // Idle hover + a slow arm sway.
    this.group.position.y = this._baseY + Math.sin(this._t * 1.5) * 0.055;
    this.body.rotation.z = Math.sin(this._t * 0.9) * 0.02;
    const swing = this.speaking ? 0.35 : 0.06;
    for (let i = 0; i < this.arms.length; i++) {
      const sx = i === 0 ? -1 : 1;
      this.arms[i].rotation.x = Math.sin(this._t * (this.speaking ? 5 : 1.2) + i) * swing;
      this.arms[i].rotation.z = sx * (0.12 + Math.sin(this._t * 1.1) * 0.05);
    }
    this.tipMaterial.color.setHex(this.color);
    this.glow.intensity = 5 + Math.sin(this._t * 2.4) * 1.5;

    // Turn to face the dog when it's close, drift back to rest otherwise.
    if (dogPosition) {
      this._v.subVectors(dogPosition, this.group.position);
      const dist = this._v.length();
      this.nearDog = dist < NOTICE_RANGE;
      const targetYaw = this.nearDog ? Math.atan2(-this._v.x, -this._v.z) : this.restYaw;
      this.group.rotation.y = dampAngle(this.group.rotation.y, targetYaw, 4, dt);
      // Nod the head down at a dog-height target.
      const pitch = this.nearDog ? THREE.MathUtils.clamp(0.9 / Math.max(dist, 1.2), 0, 0.45) : 0;
      this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, pitch, Math.min(1, dt * 4));
    }

    // Dialogue: reveal, hold, fade.
    if (this.speaking) {
      if (this._revealed < this._words.length) {
        this._wordTimer += dt;
        while (this._wordTimer >= WORD_INTERVAL && this._revealed < this._words.length) {
          this._wordTimer -= WORD_INTERVAL;
          this._revealed++;
          this._redrawBubble();
        }
      }
      this._sayTimer -= dt;
      if (this._sayTimer <= 0) this.speaking = false;
    }

    const targetOpacity = this.speaking ? 1 : 0;
    this._bubbleMaterial.opacity += (targetOpacity - this._bubbleMaterial.opacity) * Math.min(1, dt * 8);
    if (this._bubbleMaterial.opacity < 0.02) {
      this._bubbleMaterial.opacity = 0;
      this.bubble.visible = false;
    } else {
      this.bubble.visible = true;
    }
    return this;
  }
}

function dampAngle(current, target, rate, dt) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.min(1, rate * dt);
}
