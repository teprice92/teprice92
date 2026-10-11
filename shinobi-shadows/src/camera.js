import * as THREE from 'three';
import { raycast } from './physics.js';

// Over-the-shoulder third-person camera with wall collision.

export class ThirdPersonCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI;
    this.pitch = 0.25;
    this.distance = 5.5;
    this.targetDistance = 5.5;
    this.currentDist = 5.5;
    this.shakeAmt = 0;
    this.pivot = new THREE.Vector3();
    this.sensitivity = 0.0024;
  }

  get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get right() { return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  shake(amount) { this.shakeAmt = Math.max(this.shakeAmt, amount); }

  handleInput(input, dt) {
    this.yaw -= input.mouseDX * this.sensitivity;
    this.pitch += input.mouseDY * this.sensitivity;
    // Keyboard fallback for when pointer lock is unavailable.
    const turn = 2.6 * dt;
    if (input.down('ArrowLeft')) this.yaw += turn;
    if (input.down('ArrowRight')) this.yaw -= turn;
    if (input.down('ArrowUp')) this.pitch -= turn * 0.6;
    if (input.down('ArrowDown')) this.pitch += turn * 0.6;
    this.pitch = Math.max(-0.45, Math.min(1.25, this.pitch));
  }

  update(dt, player, colliders) {
    const headY = player.crouching ? 1.15 : 1.6;
    const right = this.right;
    this.pivot.set(player.pos.x, player.pos.y + headY, player.pos.z).addScaledVector(right, 0.55);

    const cp = Math.cos(this.pitch);
    const back = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);

    let want = this.targetDistance;
    const hit = raycast(colliders, this.pivot, back, want + 0.3);
    if (hit) want = Math.max(0.6, hit.t - 0.3);
    // Pull in instantly, ease back out.
    this.currentDist = want < this.currentDist ? want : this.currentDist + (want - this.currentDist) * (1 - Math.exp(-dt * 6));

    this.camera.position.copy(this.pivot).addScaledVector(back, this.currentDist);
    this.camera.position.y = Math.max(this.camera.position.y, player.pos.y + 0.35);
    if (this.shakeAmt > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.exp(-dt * 8);
    }
    this.camera.lookAt(this.pivot);
  }

  /** Ray from the camera through the crosshair. */
  aimRay() {
    const origin = this.camera.position.clone();
    const dir = this.pivot.clone().sub(origin);
    if (dir.lengthSq() < 1e-6) dir.copy(this.forward);
    dir.normalize();
    // Start the ray at the pivot so we never hit things behind the player.
    const skip = origin.distanceTo(this.pivot);
    origin.addScaledVector(dir, skip);
    return { origin, dir };
  }
}
