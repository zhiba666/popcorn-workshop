export const factoryLogisticsAssets = {
  "tileSize": [
    96,
    96
  ],
  "anchor": [
    48,
    48
  ],
  "projection": [
    1,
    0.138,
    -0.1333333333,
    1,
    48,
    48
  ],
  "localTravelLimit": 40,
  "surfaceWidth": 22,
  "outerWidth": 34,
  "stride": {
    "horizontal": [
      80,
      11.04
    ],
    "vertical": [
      -10.6666666667,
      80
    ]
  },
  "materialLayer": null,
  "assets": {
    "straight-h": {
      "src": "straight-h.svg",
      "width": 96,
      "height": 96,
      "anchor": [
        48,
        48
      ],
      "ports": {
        "west": {
          "x": 8,
          "y": 42.48,
          "tangent": [
            -1,
            -0.138
          ]
        },
        "east": {
          "x": 88,
          "y": 53.52,
          "tangent": [
            1,
            0.138
          ]
        }
      },
      "paintOrder": [
        "shadow",
        "side",
        "support",
        "surface",
        "hardware"
      ]
    },
    "straight-v": {
      "src": "straight-v.svg",
      "width": 96,
      "height": 96,
      "anchor": [
        48,
        48
      ],
      "ports": {
        "north": {
          "x": 53.3333333333,
          "y": 8,
          "tangent": [
            0.1333333333,
            -1
          ]
        },
        "south": {
          "x": 42.6666666667,
          "y": 88,
          "tangent": [
            -0.1333333333,
            1
          ]
        }
      },
      "paintOrder": [
        "shadow",
        "side",
        "support",
        "surface",
        "hardware"
      ]
    },
    "corner-ne": {
      "src": "corner-ne.svg",
      "width": 96,
      "height": 96,
      "anchor": [
        48,
        48
      ],
      "ports": {
        "north": {
          "x": 53.3333333333,
          "y": 8,
          "tangent": [
            0.1333333333,
            -1
          ]
        },
        "east": {
          "x": 88,
          "y": 53.52,
          "tangent": [
            1,
            0.138
          ]
        }
      },
      "paintOrder": [
        "shadow",
        "side",
        "support",
        "surface",
        "hardware"
      ]
    },
    "corner-nw": {
      "src": "corner-nw.svg",
      "width": 96,
      "height": 96,
      "anchor": [
        48,
        48
      ],
      "ports": {
        "north": {
          "x": 53.3333333333,
          "y": 8,
          "tangent": [
            0.1333333333,
            -1
          ]
        },
        "west": {
          "x": 8,
          "y": 42.48,
          "tangent": [
            -1,
            -0.138
          ]
        }
      },
      "paintOrder": [
        "shadow",
        "side",
        "support",
        "surface",
        "hardware"
      ]
    },
    "corner-se": {
      "src": "corner-se.svg",
      "width": 96,
      "height": 96,
      "anchor": [
        48,
        48
      ],
      "ports": {
        "east": {
          "x": 88,
          "y": 53.52,
          "tangent": [
            1,
            0.138
          ]
        },
        "south": {
          "x": 42.6666666667,
          "y": 88,
          "tangent": [
            -0.1333333333,
            1
          ]
        }
      },
      "paintOrder": [
        "shadow",
        "side",
        "support",
        "surface",
        "hardware"
      ]
    },
    "corner-sw": {
      "src": "corner-sw.svg",
      "width": 96,
      "height": 96,
      "anchor": [
        48,
        48
      ],
      "ports": {
        "west": {
          "x": 8,
          "y": 42.48,
          "tangent": [
            -1,
            -0.138
          ]
        },
        "south": {
          "x": 42.6666666667,
          "y": 88,
          "tangent": [
            -0.1333333333,
            1
          ]
        }
      },
      "paintOrder": [
        "shadow",
        "side",
        "support",
        "surface",
        "hardware"
      ]
    },
    "junction-east": {
      "src": "junction-east.svg",
      "width": 96,
      "height": 96,
      "anchor": [
        48,
        48
      ],
      "ports": {
        "north": {
          "x": 53.3333333333,
          "y": 8,
          "tangent": [
            0.1333333333,
            -1
          ]
        },
        "south": {
          "x": 42.6666666667,
          "y": 88,
          "tangent": [
            -0.1333333333,
            1
          ]
        },
        "east": {
          "x": 88,
          "y": 53.52,
          "tangent": [
            1,
            0.138
          ]
        }
      },
      "paintOrder": [
        "shadow",
        "side",
        "support",
        "surface",
        "hardware"
      ]
    },
    "junction-west": {
      "src": "junction-west.svg",
      "width": 96,
      "height": 96,
      "anchor": [
        48,
        48
      ],
      "ports": {
        "north": {
          "x": 53.3333333333,
          "y": 8,
          "tangent": [
            0.1333333333,
            -1
          ]
        },
        "south": {
          "x": 42.6666666667,
          "y": 88,
          "tangent": [
            -0.1333333333,
            1
          ]
        },
        "west": {
          "x": 8,
          "y": 42.48,
          "tangent": [
            -1,
            -0.138
          ]
        }
      },
      "paintOrder": [
        "shadow",
        "side",
        "support",
        "surface",
        "hardware"
      ]
    },
    "end-cap": {
      "src": "end-cap.svg",
      "width": 96,
      "height": 96,
      "anchor": [
        48,
        48
      ],
      "ports": {
        "west": {
          "x": 8,
          "y": 42.48,
          "tangent": [
            -1,
            -0.138
          ]
        }
      },
      "paintOrder": [
        "shadow",
        "side",
        "support",
        "surface",
        "hardware"
      ]
    },
    "connector": {
      "src": "connector.svg",
      "width": 96,
      "height": 96,
      "anchor": [
        48,
        48
      ],
      "ports": {
        "west": {
          "x": 8,
          "y": 42.48,
          "tangent": [
            -1,
            -0.138
          ]
        },
        "east": {
          "x": 88,
          "y": 53.52,
          "tangent": [
            1,
            0.138
          ]
        }
      },
      "paintOrder": [
        "shadow",
        "side",
        "support",
        "surface",
        "hardware"
      ]
    }
  }
};
export default factoryLogisticsAssets;
