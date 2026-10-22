// three.js r186 examples/jsm/lines/LineMaterial.js (MIT, the three.js authors), trimmed by
// scripts/trim-lines.mjs. Don't edit it by hand: after upgrading three, re-run the script.
// Cut: world units (setting worldUnits true throws), the shaders' WORLD_UNITS branches and
// closestLineToLine, which only they call: every line is in screen px.
// What the five files cut, and the three.js classes only that reaches, stay out of the first-load
// JS; tests/unit/lines.test.ts checks them against three's.
// three-revision: 186

import {
	ShaderLib,
	ShaderMaterial,
	UniformsLib,
	UniformsUtils,
	Vector2,
} from 'three';

UniformsLib.line = {

	worldUnits: { value: 1 },
	linewidth: { value: 1 },
	resolution: { value: new Vector2() },
	dashOffset: { value: 0 },
	dashScale: { value: 1 },
	dashSize: { value: 1 },
	gapSize: { value: 1 } // todo FIX - maybe change to totalSize

};

ShaderLib[ 'line' ] = {

	uniforms: UniformsUtils.merge( [
		UniformsLib.common,
		UniformsLib.fog,
		UniformsLib.line
	] ),

	vertexShader:
	/* glsl */`
		#include <common>
		#include <color_pars_vertex>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec3 instanceColorStart;
		attribute vec3 instanceColorEnd;


		varying vec2 vUv;


		#ifdef USE_DASH

			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;

		#endif

		float trimSegmentAlpha( const in vec4 start, const in vec4 end ) {

			// compute the interpolation factor needed to trim the segment so it terminates
			// between the camera plane and the near plane

			// conservative estimate of the near plane
			float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
			float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column

			// we need different nearEstimate formula for reversed and default depth buffer
			// a is positive with a reversed depth buffer so it can be used for controlling the code flow
			float nearEstimate = ( a > 0.0 ) ? ( - b / ( a + 1.0 ) ) : ( - 0.5 * b / a );

			return ( nearEstimate - start.z ) / ( end.z - start.z );

		}

		void main() {

			#ifdef USE_COLOR

				vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			#endif

			float aspect = resolution.x / resolution.y;

			// camera space
			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef USE_DASH

				float lineDistanceStart = dashScale * instanceDistanceStart;
				float lineDistanceEnd = dashScale * instanceDistanceEnd;

			#endif


			vUv = uv;


			// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
			// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
			// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
			// perhaps there is a more elegant solution -- WestLangley

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

			if ( perspective ) {

				if ( start.z < 0.0 && end.z >= 0.0 ) {

					float alpha = trimSegmentAlpha( start, end );
					end.xyz = mix( start.xyz, end.xyz, alpha );

					#ifdef USE_DASH

						lineDistanceEnd = mix( lineDistanceStart, lineDistanceEnd, alpha );

					#endif

				} else if ( end.z < 0.0 && start.z >= 0.0 ) {

					float alpha = trimSegmentAlpha( end, start );
					start.xyz = mix( end.xyz, start.xyz, alpha );

					#ifdef USE_DASH

						lineDistanceStart = mix( lineDistanceEnd, lineDistanceStart, alpha );

					#endif

				}

			}

			#ifdef USE_DASH

				vLineDistance = ( position.y < 0.5 ) ? lineDistanceStart : lineDistanceEnd;
				vUv = uv;

			#endif

			// clip space
			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			// ndc space
			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			// direction
			vec2 dir = ndcEnd.xy - ndcStart.xy;

			// account for clip-space aspect ratio
			dir.x *= aspect;
			dir = normalize( dir );


			vec2 offset = vec2( dir.y, - dir.x );
			// undo aspect ratio adjustment
			dir.x /= aspect;
			offset.x /= aspect;

			// sign flip
			if ( position.x < 0.0 ) offset *= - 1.0;

			// endcaps
			if ( position.y < 0.0 ) {

				offset += - dir;

			} else if ( position.y > 1.0 ) {

				offset += dir;

			}

			// adjust for linewidth
			offset *= linewidth;

			// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
			offset /= resolution.y;

			// select end
			vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

			// back to clip space
			offset *= clip.w;

			clip.xy += offset;


			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,

	fragmentShader:
	/* glsl */`
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH

			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;

		#endif

		varying float vLineDistance;


		varying vec2 vUv;


		#include <common>
		#include <color_pars_fragment>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		void main() {

			float alpha = opacity;
			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <clipping_planes_fragment>

			#ifdef USE_DASH

				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

			#endif


			#ifdef USE_ALPHA_TO_COVERAGE

				// artifacts appear on some hardware if a derivative is taken within a conditional
				float a = vUv.x;
				float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
				float len2 = a * a + b * b;
				float dlen = fwidth( len2 );

				if ( abs( vUv.y ) > 1.0 ) {

					alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

				}

			#else

				if ( abs( vUv.y ) > 1.0 ) {

					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;

					if ( len2 > 1.0 ) discard;

				}

			#endif


			#include <logdepthbuf_fragment>
			#include <color_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`
};

/**
 * A material for drawing wireframe-style geometries.
 *
 * Unlike {@link LineBasicMaterial}, it supports arbitrary line widths and allows using world units
 * instead of screen space units. This material is used with {@link LineSegments2} and {@link Line2}.
 *
 * This module can only be used with {@link WebGLRenderer}. When using {@link WebGPURenderer},
 * use {@link Line2NodeMaterial}.
 *
 * @augments ShaderMaterial
 * @three_import import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
 */
class LineMaterial extends ShaderMaterial {

	/**
	 * Constructs a new line segments geometry.
	 *
	 * @param {Object} [parameters] - An object with one or more properties
	 * defining the material's appearance. Any property of the material
	 * (including any property from inherited materials) can be passed
	 * in here. Color values can be passed any type of value accepted
	 * by {@link Color#set}.
	 */
	constructor( parameters ) {

		super( {

			type: 'LineMaterial',
			uniforms: UniformsUtils.clone( ShaderLib[ 'line' ].uniforms ),

			vertexShader: ShaderLib[ 'line' ].vertexShader,
			fragmentShader: ShaderLib[ 'line' ].fragmentShader,

			clipping: true // required for clipping support

		} );

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isLineMaterial = true;

		this.setValues( parameters );

	}

	/**
	 * The material's color.
	 *
	 * @type {Color}
	 * @default (1,1,1)
	 */
	get color() {

		return this.uniforms.diffuse.value;

	}

	set color( value ) {

		this.uniforms.diffuse.value = value;

	}

	/**
	 * Whether the material's sizes (width, dash gaps) are in world units.
	 *
	 * @type {boolean}
	 * @default false
	 */
	get worldUnits() {

		return 'WORLD_UNITS' in this.defines;

	}

	set worldUnits( value ) {

		if ( value === true ) throw new Error( 'LineMaterial: worldUnits is trimmed out of this copy (src/vendor/lines/LineMaterial.js).' );

	}

	/**
	 * Controls line thickness in CSS pixel units when `worldUnits` is `false` (default),
	 * or in world units when `worldUnits` is `true`.
	 *
	 * @type {number}
	 * @default 1
	 */
	get linewidth() {

		return this.uniforms.linewidth.value;

	}

	set linewidth( value ) {

		if ( ! this.uniforms.linewidth ) return;
		this.uniforms.linewidth.value = value;

	}

	/**
	 * Whether the line is dashed, or solid.
	 *
	 * @type {boolean}
	 * @default false
	 */
	get dashed() {

		return 'USE_DASH' in this.defines;

	}

	set dashed( value ) {

		if ( ( value === true ) !== this.dashed ) {

			this.needsUpdate = true;

		}

		if ( value === true ) {

			this.defines.USE_DASH = '';

		} else {

			delete this.defines.USE_DASH;

		}

	}

	/**
	 * The scale of the dashes and gaps.
	 *
	 * @type {number}
	 * @default 1
	 */
	get dashScale() {

		return this.uniforms.dashScale.value;

	}

	set dashScale( value ) {

		this.uniforms.dashScale.value = value;

	}

	/**
	 * The size of the dash.
	 *
	 * @type {number}
	 * @default 1
	 */
	get dashSize() {

		return this.uniforms.dashSize.value;

	}

	set dashSize( value ) {

		this.uniforms.dashSize.value = value;

	}

	/**
	 * Where in the dash cycle the dash starts.
	 *
	 * @type {number}
	 * @default 0
	 */
	get dashOffset() {

		return this.uniforms.dashOffset.value;

	}

	set dashOffset( value ) {

		this.uniforms.dashOffset.value = value;

	}

	/**
	 * The size of the gap.
	 *
	 * @type {number}
	 * @default 0
	 */
	get gapSize() {

		return this.uniforms.gapSize.value;

	}

	set gapSize( value ) {

		this.uniforms.gapSize.value = value;

	}

	/**
	 * The opacity.
	 *
	 * @type {number}
	 * @default 1
	 */
	get opacity() {

		return this.uniforms.opacity.value;

	}

	set opacity( value ) {

		if ( ! this.uniforms ) return;
		this.uniforms.opacity.value = value;

	}

	/**
	 * The size of the viewport, in screen pixels. This must be kept updated to make
	 * screen-space rendering accurate. The `LineSegments2.onBeforeRender` callback
	 * performs the update for visible objects.
	 *
	 * @type {Vector2}
	 */
	get resolution() {

		return this.uniforms.resolution.value;

	}

	set resolution( value ) {

		this.uniforms.resolution.value.copy( value );

	}

	/**
	 * Whether to use alphaToCoverage or not. When enabled, this can improve the
	 * anti-aliasing of line edges when using MSAA.
	 *
	 * @type {boolean}
	 */
	get alphaToCoverage() {

		return 'USE_ALPHA_TO_COVERAGE' in this.defines;

	}

	set alphaToCoverage( value ) {

		if ( ! this.defines ) return;

		if ( ( value === true ) !== this.alphaToCoverage ) {

			this.needsUpdate = true;

		}

		if ( value === true ) {

			this.defines.USE_ALPHA_TO_COVERAGE = '';

		} else {

			delete this.defines.USE_ALPHA_TO_COVERAGE;

		}

	}

}

export { LineMaterial };
