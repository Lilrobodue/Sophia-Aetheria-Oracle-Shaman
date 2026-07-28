// tools/test-fixtures/jpl-ground-truth.js
// Geocentric APPARENT ecliptic longitude/latitude of date, in degrees — the
// coordinate system natal astrology uses. Pulled directly from NASA JPL
// Horizons (CENTER=500@399, QUANTITIES=31) on 2026-07-28, NOT from any model
// or secondary source. This is the pass/fail bar for tools/astro-ephemeris.js.
//
// Self-check: at the 2024-04-08 epoch Sun 19.398 and Moon 19.360 are conjunct
// with the Moon 0.35 deg off the node — which is exactly what a solar eclipse
// requires, and that date was one.
//
// jd_ut is the Julian Day in UT (not TT); an engine working in TT must add
// Delta-T (about 64 s in 2000, about 69 s in 2024) before comparing.

export const JPL_GROUND_TRUTH = [
  {
    "utc": "1969-07-20T20:17Z",
    "jd_ut": 2440423.34514,
    "bodies": {
      "Sun": {
        "lon": 117.9107313,
        "lat": -0.0001002
      },
      "Moon": {
        "lon": 187.873766,
        "lat": -1.3631494
      },
      "Mercury": {
        "lon": 115.8429011,
        "lat": 1.4588007
      },
      "Venus": {
        "lon": 75.0374099,
        "lat": -2.4542346
      },
      "Mars": {
        "lon": 242.7732834,
        "lat": -3.3930191
      },
      "Jupiter": {
        "lon": 180.7462245,
        "lat": 1.2191713
      },
      "Saturn": {
        "lon": 38.0979955,
        "lat": -2.4284393
      },
      "Uranus": {
        "lon": 180.6900011,
        "lat": 0.7107021
      },
      "Neptune": {
        "lon": 236.0229075,
        "lat": 1.72992
      },
      "Pluto": {
        "lon": 173.0071871,
        "lat": 15.3060847
      }
    }
  },
  {
    "utc": "1985-07-04T20:30Z",
    "jd_ut": 2446251.35417,
    "bodies": {
      "Sun": {
        "lon": 102.7836152,
        "lat": -0.0001916
      },
      "Moon": {
        "lon": 312.94148,
        "lat": -5.0820273
      },
      "Mercury": {
        "lon": 127.3733829,
        "lat": 1.0263447
      },
      "Venus": {
        "lon": 58.4189121,
        "lat": -2.7992765
      },
      "Mars": {
        "lon": 106.787107,
        "lat": 0.9830966
      },
      "Jupiter": {
        "lon": 315.5797814,
        "lat": -0.76655
      },
      "Saturn": {
        "lon": 231.8188394,
        "lat": 2.2403588
      },
      "Uranus": {
        "lon": 254.8964311,
        "lat": -0.0330911
      },
      "Neptune": {
        "lon": 271.9441885,
        "lat": 1.1608737
      },
      "Pluto": {
        "lon": 211.9402027,
        "lat": 16.872572
      }
    }
  },
  {
    "utc": "2000-01-01T12:00Z",
    "jd_ut": 2451545,
    "bodies": {
      "Sun": {
        "lon": 280.3689092,
        "lat": 0.0002381
      },
      "Moon": {
        "lon": 223.323786,
        "lat": 5.1707422
      },
      "Mercury": {
        "lon": 271.8892699,
        "lat": -0.994819
      },
      "Venus": {
        "lon": 241.5657794,
        "lat": 2.0663548
      },
      "Mars": {
        "lon": 327.9632921,
        "lat": -1.0677752
      },
      "Jupiter": {
        "lon": 25.2530685,
        "lat": -1.2621868
      },
      "Saturn": {
        "lon": 40.3956366,
        "lat": -2.4448533
      },
      "Uranus": {
        "lon": 314.809168,
        "lat": -0.658324
      },
      "Neptune": {
        "lon": 303.1930007,
        "lat": 0.2350026
      },
      "Pluto": {
        "lon": 251.4547644,
        "lat": 10.8552605
      }
    }
  },
  {
    "utc": "2024-04-08T18:17Z",
    "jd_ut": 2460409.26181,
    "bodies": {
      "Sun": {
        "lon": 19.3977975,
        "lat": -0.0000531
      },
      "Moon": {
        "lon": 19.3603106,
        "lat": 0.3456159
      },
      "Mercury": {
        "lon": 24.7995512,
        "lat": 2.8345008
      },
      "Venus": {
        "lon": 4.441784,
        "lat": -1.49651
      },
      "Mars": {
        "lon": 343.0493376,
        "lat": -1.2447136
      },
      "Jupiter": {
        "lon": 49.0451421,
        "lat": -0.8016549
      },
      "Saturn": {
        "lon": 344.4549386,
        "lat": -1.6844292
      },
      "Uranus": {
        "lon": 51.170986,
        "lat": -0.2705875
      },
      "Neptune": {
        "lon": 358.1900381,
        "lat": -1.2219166
      },
      "Pluto": {
        "lon": 301.9676119,
        "lat": -2.9641434
      }
    }
  }
];
