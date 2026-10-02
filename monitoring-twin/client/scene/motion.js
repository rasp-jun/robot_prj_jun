// Minimum-jerk interpolation with continuous position, velocity and acceleration on retarget.
// Pure math: shared by the robot choreographies and unit tests; no rendering dependency.
export const smooth = (t) => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * u * (10 + u * (-15 + 6 * u));
};

export class JointMotion {
  constructor(q) {
    this.q = [...q];
    this.v = q.map(() => 0);
    this.a = q.map(() => 0);
    this.queue = [];
    this.segment = null;
    this.phase = "대기";
    this.completed = [];
  }

  path(points) {
    this.queue = points.map((p) => ({ ...p, q: [...p.q] }));
    this.segment = null;
    this.next();
  }

  next() {
    const point = this.queue.shift();
    if (!point) { this.segment = null; return; }
    const duration = Math.max(0.05, point.seconds);
    const coefficients = this.q.map((q, i) => {
      const d = point.q[i] - q, v = this.v[i] * duration, a = this.a[i] * duration * duration;
      return [q, v, a / 2, 10 * d - 6 * v - 1.5 * a, -15 * d + 8 * v + 1.5 * a, 6 * d - 3 * v - 0.5 * a];
    });
    this.phase = point.label;
    this.segment = { target: point.q, duration, elapsed: 0, coefficients, action:point.action };
  }

  resume(minimumDuration = () => .2) {
    // A stopped arm restarts from rest, rather than jumping straight to its pre-pause speed.
    this.v.fill(0); this.a.fill(0);
    if (!this.segment) return;
    this.queue.unshift({ q: this.segment.target, seconds: Math.max(minimumDuration(this.q,this.segment.target), this.segment.duration - this.segment.elapsed), label: this.phase, action:this.segment.action });
    this.next();
  }

  checkpoint() {
    return {q:[...this.q],v:[...this.v],a:[...this.a],queue:[...this.queue],
      segment:this.segment?{...this.segment}:null,phase:this.phase,completed:[...this.completed]};
  }

  restore(saved) { Object.assign(this,saved); }

  tick(dt) {
    let remaining = Math.max(0, dt);
    while (this.segment && remaining > 0) {
      const s = this.segment;
      const used = Math.min(remaining, s.duration - s.elapsed);
      s.elapsed += used; remaining -= used;
      const u = Math.min(1, s.elapsed / s.duration);
      s.coefficients.forEach(([c0, c1, c2, c3, c4, c5], i) => {
        this.q[i] = c0 + u * (c1 + u * (c2 + u * (c3 + u * (c4 + u * c5))));
        this.v[i] = (c1 + u * (2*c2 + u * (3*c3 + u * (4*c4 + u * 5*c5)))) / s.duration;
        this.a[i] = (2*c2 + u * (6*c3 + u * (12*c4 + u * 20*c5))) / (s.duration*s.duration);
      });
      if (s.elapsed >= s.duration - 1e-9) {
        if(s.action)this.completed.push(s.action);
        this.q = [...s.target]; this.v.fill(0); this.a.fill(0);
        this.next();
      }
    }
    return this.q;
  }
}

export const READY_POSE = [0, 0, -90, 0, -90, 0];
const WORK = [23, -32, -99, 0, -64, 0];
const ABOVE = [23, -18, -99, 0, -78, 0];

// Illustrative joint-space choreography, not collision-validated physical robot commands.
export function jobPath(job, duration = 4, ng = false) {
  let points;
  if (job === "ROBOT2_WELD_MOTION") {
    points = [[ABOVE,.12,"용접 접근"],[WORK,.16,"용접점 정렬"],
      [[17,-33,-99,-4,-64,4],.16,"용접 경로 1/4"],[[23,-35,-96,0,-66,0],.16,"용접 경로 2/4"],
      [[29,-33,-99,4,-64,-4],.16,"용접 경로 3/4"],[WORK,.16,"용접 경로 4/4"],[ABOVE,.08,"툴 상승"]];
  } else if (job === "ROBOT3_SORT") {
    const side = ng ? -25 : 55;
    points = [[ABOVE,.16,"검사품 접근"],[[23,-37,-100,0,-60,0],.2,"검사품 집기"],
      [ABOVE,.18,"검사품 들어올리기"],[[side,-18,-99,0,-78,0],.25,ng ? "불합격 트레이 이동" : "합격 트레이 이동"],
      [[side,-32,-99,0,-64,0],.21,"트레이 안착"]];
  } else {
    const side = job === "ROBOT1_POWERPACK_MOUNT" ? -30 : job === "ROBOT2_TURRET_MATE" ? -20 : -38;
    points = [[[side,-12,-96,0,-78,0],.18,"부품 접근"],[[side,-27,-102,0,-63,0],.18,"부품 집기"],
      [[side,-10,-96,0,-82,0],.18,"부품 들어올리기"],[ABOVE,.24,"조립 위치 정렬"],
      [WORK,.17,"부품 안착"],[WORK,.05,"안착 확인"]];
  }
  return points.map(([q, fraction, label]) => ({q, seconds:Math.max(.1,duration)*fraction, label}));
}
