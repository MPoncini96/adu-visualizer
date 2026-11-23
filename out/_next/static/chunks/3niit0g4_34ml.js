(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,14287,e=>{"use strict";var t=e.i(90072);class r extends t.kE{constructor(e,a={}){super(e),this.isReflector=!0,this.type="Reflector",this.forceUpdate=!1,this.camera=new t.zm;let n=this,o=new t.Es(void 0!==a.color?a.color:8355711),l=a.textureWidth||512,i=a.textureHeight||512,s=a.clipBias||0,d=a.shader||r.ReflectorShader,c=void 0!==a.multisample?a.multisample:4,u=new t._m,m=new t.cE,p=new t.cE,f=new t.cE,v=new t.nd,x=new t.cE(0,0,-1),b=new t.$h,h=new t.cE,g=new t.cE,y=new t.$h,w=new t.nd,M=this.camera,R=new t.qL(l,i,{samples:c,type:t.HN}),S=new t.Zg({name:void 0!==d.name?d.name:"unspecified",uniforms:t.SP.clone(d.uniforms),fragmentShader:d.fragmentShader,vertexShader:d.vertexShader});S.uniforms.tDiffuse.value=R.texture,S.uniforms.color.value=o,S.uniforms.textureMatrix.value=w,this.material=S,this.onBeforeRender=function(e,t,r){if(p.setFromMatrixPosition(n.matrixWorld),f.setFromMatrixPosition(r.matrixWorld),v.extractRotation(n.matrixWorld),m.set(0,0,1),m.applyMatrix4(v),h.subVectors(p,f),!0==h.dot(m)>0&&!1===this.forceUpdate)return;h.reflect(m).negate(),h.add(p),v.extractRotation(r.matrixWorld),x.set(0,0,-1),x.applyMatrix4(v),x.add(f),g.subVectors(p,x),g.reflect(m).negate(),g.add(p),M.position.copy(h),M.up.set(0,1,0),M.up.applyMatrix4(v),M.up.reflect(m),M.lookAt(g),M.far=r.far,M.updateMatrixWorld(),M.projectionMatrix.copy(r.projectionMatrix),w.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),w.multiply(M.projectionMatrix),w.multiply(M.matrixWorldInverse),w.multiply(n.matrixWorld),u.setFromNormalAndCoplanarPoint(m,p),u.applyMatrix4(M.matrixWorldInverse),b.set(u.normal.x,u.normal.y,u.normal.z,u.constant);let a=M.projectionMatrix;y.x=(Math.sign(b.x)+a.elements[8])/a.elements[0],y.y=(Math.sign(b.y)+a.elements[9])/a.elements[5],y.z=-1,y.w=(1+a.elements[10])/a.elements[14],b.multiplyScalar(2/b.dot(y)),a.elements[2]=b.x,a.elements[6]=b.y,a.elements[10]=b.z+1-s,a.elements[14]=b.w,n.visible=!1;let o=e.getRenderTarget(),l=e.xr.enabled,i=e.shadowMap.autoUpdate;e.xr.enabled=!1,e.shadowMap.autoUpdate=!1,e.setRenderTarget(R),e.state.buffers.depth.setMask(!0),!1===e.autoClear&&e.clear(),e.render(t,M),e.xr.enabled=l,e.shadowMap.autoUpdate=i,e.setRenderTarget(o);let d=r.viewport;void 0!==d&&e.state.viewport(d),n.visible=!0,this.forceUpdate=!1},this.getRenderTarget=function(){return R},this.dispose=function(){R.dispose(),n.material.dispose()}}}r.ReflectorShader={name:"ReflectorShader",uniforms:{color:{value:null},tDiffuse:{value:null},textureMatrix:{value:null}},vertexShader:`
		uniform mat4 textureMatrix;
		varying vec4 vUv;

		#include <common>
		#include <logdepthbuf_pars_vertex>

		void main() {

			vUv = textureMatrix * vec4( position, 1.0 );

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

			#include <logdepthbuf_vertex>

		}`,fragmentShader:`
		uniform vec3 color;
		uniform sampler2D tDiffuse;
		varying vec4 vUv;

		#include <logdepthbuf_pars_fragment>

		float blendOverlay( float base, float blend ) {

			return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );

		}

		vec3 blendOverlay( vec3 base, vec3 blend ) {

			return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );

		}

		void main() {

			#include <logdepthbuf_fragment>

			vec4 base = texture2DProj( tDiffuse, vUv );
			gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}`},e.s(["Reflector",0,r])}]);