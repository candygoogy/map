// three.js r186 examples/jsm/lines/LineSegments2.js (MIT, the three.js authors), trimmed by
// scripts/trim-lines.mjs. Don't edit it by hand: after upgrading three, re-run the script.
// Cut: raycast() (it throws) and its helpers: nothing on the map raycasts its lines.
// What the five files cut, and the three.js classes only that reaches, stay out of the first-load
// JS; tests/unit/lines.test.ts checks them against three's.
// three-revision: 186

import {
	InstancedInterleavedBuffer,
	InterleavedBufferAttribute,
	Mesh,
	Vector3,
	Vector4
} from 'three';
import { LineSegmentsGeometry } from './LineSegmentsGeometry.js';
import { LineMaterial } from './LineMaterial.js';

const _viewport = new Vector4();

const _start = new Vector3();
const _end = new Vector3();

/**
 * A series of lines drawn between pairs of vertices.
 *
 * This adds functionality beyond {@link LineSegments}, like arbitrary line width and changing width
 * to be in world units. {@link Line2} extends this object, forming a polyline instead of individual
 * segments.
 *
 * This module can only be used with {@link WebGLRenderer}. When using {@link WebGPURenderer},
 * import the class from `lines/webgpu/LineSegments2.js`.
 *
 *  ```js
 * const geometry = new LineSegmentsGeometry();
 * geometry.setPositions( positions );
 * geometry.setColors( colors );
 *
 * const material = new LineMaterial( { linewidth: 5, vertexColors: true } };
 *
 * const lineSegments = new LineSegments2( geometry, material );
 * scene.add( lineSegments );
 * ```
 *
 * @augments Mesh
 * @three_import import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
 */
class LineSegments2 extends Mesh {

	/**
	 * Constructs a new wide line.
	 *
	 * @param {LineSegmentsGeometry} [geometry] - The line geometry.
	 * @param {LineMaterial} [material] - The line material.
	 */
	constructor( geometry = new LineSegmentsGeometry(), material = new LineMaterial( { color: Math.random() * 0xffffff } ) ) {

		super( geometry, material );

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isLineSegments2 = true;

		this.type = 'LineSegments2';

	}

	/**
	 * Computes an array of distance values which are necessary for rendering dashed lines.
	 * For each vertex in the geometry, the method calculates the cumulative length from the
	 * current point to the very beginning of the line.
	 *
	 * @return {LineSegments2} A reference to this instance.
	 */
	computeLineDistances() {

		// for backwards-compatibility, but could be a method of LineSegmentsGeometry...

		const geometry = this.geometry;

		const instanceStart = geometry.attributes.instanceStart;
		const instanceEnd = geometry.attributes.instanceEnd;
		const lineDistances = new Float32Array( 2 * instanceStart.count );

		for ( let i = 0, j = 0, l = instanceStart.count; i < l; i ++, j += 2 ) {

			_start.fromBufferAttribute( instanceStart, i );
			_end.fromBufferAttribute( instanceEnd, i );

			lineDistances[ j ] = ( j === 0 ) ? 0 : lineDistances[ j - 1 ];
			lineDistances[ j + 1 ] = lineDistances[ j ] + _start.distanceTo( _end );

		}

		const instanceDistanceBuffer = new InstancedInterleavedBuffer( lineDistances, 2, 1 ); // d0, d1

		geometry.setAttribute( 'instanceDistanceStart', new InterleavedBufferAttribute( instanceDistanceBuffer, 1, 0 ) ); // d0
		geometry.setAttribute( 'instanceDistanceEnd', new InterleavedBufferAttribute( instanceDistanceBuffer, 1, 1 ) ); // d1

		return this;

	}

	/**
	 * Trimmed: nothing on the map raycasts its lines.
	 */
	raycast() {

		throw new Error( 'LineSegments2: raycasting is trimmed out of this copy (src/vendor/lines/LineSegments2.js).' );

	}

	onBeforeRender( renderer ) {

		const uniforms = this.material.uniforms;

		if ( uniforms && uniforms.resolution ) {

			renderer.getViewport( _viewport );
			this.material.uniforms.resolution.value.set( _viewport.z, _viewport.w );

		}

	}

}

export { LineSegments2 };
