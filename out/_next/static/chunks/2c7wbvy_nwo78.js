(()=>{"use strict";(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,16022,e=>{var i=e.i(90072),t=e.i(38671);let r={name:"OutputShader",uniforms:{tDiffuse:{value:null},toneMappingExposure:{value:1}},vertexShader:`
		precision highp float;

		uniform mat4 modelViewMatrix;
		uniform mat4 projectionMatrix;

		attribute vec3 position;
		attribute vec2 uv;

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		precision highp float;

		uniform sampler2D tDiffuse;

		#include <tonemapping_pars_fragment>
		#include <colorspace_pars_fragment>

		varying vec2 vUv;

		void main() {

			gl_FragColor = texture2D( tDiffuse, vUv );

			// tone mapping

			#ifdef LINEAR_TONE_MAPPING

				gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );

			#elif defined( REINHARD_TONE_MAPPING )

				gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );

			#elif defined( CINEON_TONE_MAPPING )

				gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );

			#elif defined( ACES_FILMIC_TONE_MAPPING )

				gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );

			#elif defined( AGX_TONE_MAPPING )

				gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );

			#elif defined( NEUTRAL_TONE_MAPPING )

				gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );

			#elif defined( CUSTOM_TONE_MAPPING )

				gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );

			#endif

			// color space

			#ifdef SRGB_TRANSFER

				gl_FragColor = sRGBTransferOETF( gl_FragColor );

			#endif

		}`};class a extends t.u{constructor(){super(),this.isOutputPass=!0,this.uniforms=i.SP.clone(r.uniforms),this.material=new i.or({name:r.name,uniforms:this.uniforms,vertexShader:r.vertexShader,fragmentShader:r.fragmentShader}),this._fsQuad=new t.C(this.material),this._outputColorSpace=null,this._toneMapping=null}render(e,t,r){this.uniforms.tDiffuse.value=r.texture,this.uniforms.toneMappingExposure.value=e.toneMappingExposure,(this._outputColorSpace!==e.outputColorSpace||this._toneMapping!==e.toneMapping)&&(this._outputColorSpace=e.outputColorSpace,this._toneMapping=e.toneMapping,this.material.defines={},i.v0.getTransfer(this._outputColorSpace)===i.W7&&(this.material.defines.SRGB_TRANSFER=""),this._toneMapping===i.N9?this.material.defines.LINEAR_TONE_MAPPING="":this._toneMapping===i.Gr?this.material.defines.REINHARD_TONE_MAPPING="":this._toneMapping===i.d4?this.material.defines.CINEON_TONE_MAPPING="":this._toneMapping===i.c2?this.material.defines.ACES_FILMIC_TONE_MAPPING="":this._toneMapping===i.Li?this.material.defines.AGX_TONE_MAPPING="":this._toneMapping===i.x8?this.material.defines.NEUTRAL_TONE_MAPPING="":this._toneMapping===i.lG&&(this.material.defines.CUSTOM_TONE_MAPPING=""),this.material.needsUpdate=!0),!0===this.renderToScreen?e.setRenderTarget(null):(e.setRenderTarget(t),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil)),this._fsQuad.render(e)}dispose(){this.material.dispose(),this._fsQuad.dispose()}}e.s(["OutputPass",0,a],16022)},38671,e=>{var i=e.i(90072);let t=new i.Sc(-1,1,1,-1,0,1);class r extends i.ld{constructor(){super(),this.setAttribute("position",new i.ki([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new i.ki([0,2,0,0,2,0],2))}}let a=new r;e.s(["C",0,class{constructor(e){this._mesh=new i.kE(a,e)}dispose(){this._mesh.geometry.dispose()}render(e){e.render(this._mesh,t)}get material(){return this._mesh.material}set material(e){this._mesh.material=e}},"u",0,class{constructor(){this.isPass=!0,this.enabled=!0,this.needsSwap=!0,this.clear=!1,this.renderToScreen=!1}setSize(){}render(){console.error("THREE.Pass: .render() must be implemented in derived pass.")}dispose(){}}])}])})();