import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface OS1AnimationProps {
  isTTSProcessing?: boolean;
  showTransformation?: boolean;
}

export function OS1Animation({ isTTSProcessing = false, showTransformation = false }: OS1AnimationProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const animationStateRef = useRef({
    toend: false,
    animatestep: 0
  });

  useEffect(() => {
    if (!wrapperRef.current) return;

    let animationFrameId: number;
    
    // Set up Three.js scene
    const length = 30;
    const radius = 5.6;
    const pi2 = Math.PI * 2;
    
    // Animation speeds
    const normalRotateValue = 0.035;
    const fastRotateValue = 0.12;
    const transformationSpeed = 1.8; // Faster step increment for transformation animation
    const normalSpeed = 1; // Normal step increment
    
    let rotatevalue = normalRotateValue;
    let acceleration = 0;
    let stepIncrement = normalSpeed;
    const animState = animationStateRef.current;
    
    const camera = new THREE.PerspectiveCamera(65, 1, 1, 10000);
    camera.position.z = 150;
    
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#d1684e');
    const group = new THREE.Group();
    scene.add(group);
    
    // Create a custom curve
    class CustomSinCurve extends THREE.Curve<THREE.Vector3> {
      constructor(private scale = 1) {
        super();
      }
      
      getPoint(t: number): THREE.Vector3 {
        const x = length * Math.sin(pi2 * t);
        const y = radius * Math.cos(pi2 * 3 * t);
        let tmod;
        
        tmod = t % 0.25 / 0.25;
        tmod = t % 0.25 - (2 * (1 - tmod) * tmod * -0.0185 + tmod * tmod * 0.25);
        if (Math.floor(t / 0.25) == 0 || Math.floor(t / 0.25) == 2) {
          tmod *= -1;
        }
        const z = radius * Math.sin(pi2 * 2 * (t - tmod));
        
        return new THREE.Vector3(x, y, z).multiplyScalar(this.scale);
      }
    }
    
    // Create the tube mesh
    const path = new CustomSinCurve(1);
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(path, 200, 1.1, 2, true),
      new THREE.MeshBasicMaterial({
        color: 0xffffff
      })
    );
    group.add(mesh);
    
    // Ring cover
    const ringcover = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 15, 1),
      new THREE.MeshBasicMaterial({ color: 0xd1684e, opacity: 0, transparent: true })
    );
    ringcover.position.x = length + 1;
    ringcover.rotation.y = Math.PI / 2;
    group.add(ringcover);
    
    // Ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(4.3, 5.55, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0, transparent: true })
    );
    ring.position.x = length + 1.1;
    ring.rotation.y = Math.PI / 2;
    group.add(ring);
    
    // Fake shadow
    for (let i = 0; i < 10; i++) {
      const plain = new THREE.Mesh(
        new THREE.PlaneGeometry(length * 2 + 1, radius * 3, 1),
        new THREE.MeshBasicMaterial({ color: 0xd1684e, transparent: true, opacity: 0.13 })
      );
      plain.position.z = -2.5 + i * 0.5;
      group.add(plain);
    }
    
    // Set up renderer with pixel ratio for high DPI displays
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
      });
    } catch (err) {
      // No WebGL (old GPU, remote desktop): skip the animation, keep the app working.
      console.warn('OS1 animation disabled:', err);
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    
    // Adjust size on resize
    const updateSize = () => {
      const size = Math.min(window.innerWidth, window.innerHeight) * 0.9;
      renderer.setSize(size, size);
    };
    
    updateSize();
    window.addEventListener('resize', updateSize);
    
    renderer.setClearColor('#d1684e');
    
    // Add to DOM
    wrapperRef.current.innerHTML = '';
    wrapperRef.current.appendChild(renderer.domElement);
    
    // Event listeners
    const start = () => {
      animState.toend = true;
    };
    
    const back = () => {
      animState.toend = false;
    };
    

    
    // Easing function
    const easing = (t: number, b: number, c: number, d: number) => {
      if ((t /= d / 2) < 1) return c / 2 * t * t + b;
      return c / 2 * ((t -= 2) * t * t + 2) + b;
    };
    
    // Render function
    const render = () => {
      // Update rotation speed based on TTS processing status
      rotatevalue = isTTSProcessing ? fastRotateValue : normalRotateValue;
      
      // Update transformation state from props or mouse events
      if (showTransformation && !animState.toend) {
        animState.toend = true;
        stepIncrement = transformationSpeed; // Use faster animation for loading completion
      } else if (!showTransformation && animState.toend && !document.body.matches(':active')) {
        // Only revert if it wasn't triggered by mouse down
        animState.toend = false;
        stepIncrement = normalSpeed; // Use normal speed for reverting
      }
      
      // Update animation steps with variable speed
      if (animState.toend) {
        animState.animatestep = Math.min(240, animState.animatestep + stepIncrement);
      } else {
        animState.animatestep = Math.max(0, animState.animatestep - (stepIncrement * 1.4)); // Slightly slower unwinding
      }
      
      acceleration = easing(animState.animatestep, 0, 1, 240);
      
      if (acceleration > 0.35) {
        const progress = (acceleration - 0.35) / 0.65;
        group.rotation.y = -Math.PI / 2 * progress;
        group.position.z = 50 * progress;
        const progressOpacity = Math.max(0, (acceleration - 0.97) / 0.03);
        mesh.material.opacity = 1 - progressOpacity;
        ringcover.material.opacity = ring.material.opacity = progressOpacity;
        ring.scale.x = ring.scale.y = 0.9 + 0.1 * progressOpacity;
      }
      
      renderer.render(scene, camera);
    };
    
    // Animation loop
    const animate = () => {
      mesh.rotation.x += rotatevalue + acceleration;
      render();
      animationFrameId = requestAnimationFrame(animate);
    };
    
    animate();
    
    // Clean up
    return () => {
      cancelAnimationFrame(animationFrameId);
      document.body.removeEventListener('mousedown', start);
      document.body.removeEventListener('touchstart', start);
      document.body.removeEventListener('mouseup', back);
      document.body.removeEventListener('touchend', back);
      window.removeEventListener('resize', updateSize);
      renderer.dispose();
      if (wrapperRef.current) {
        wrapperRef.current.innerHTML = '';
      }
    };
  }, [isTTSProcessing, showTransformation]);
  
  return <div ref={wrapperRef} id="wrap"></div>;
} 