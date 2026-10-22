// Small extracted geometry fixtures from public arXiv PDFs 1706.03762v7 and
// 1512.03385v1. Coordinates use the displayed page; no full PDF is bundled.
export const figureCandidateCases = {
  "attention4": {
    "page": 4,
    "text": [
      {
        "x": 0.24147549019607842,
        "y": 0.08685909090909091,
        "width": 0.19352187712418292,
        "height": 0.012579040404040398,
        "text": "Scaled Dot-Product Attention"
      },
      {
        "x": 0.5940947712418301,
        "y": 0.08685909090909091,
        "width": 0.14152752352941178,
        "height": 0.012579040404040398,
        "text": "Multi-Head Attention"
      },
      {
        "x": 0.17647058823529413,
        "y": 0.34350555555555556,
        "width": 0.6470542656666662,
        "height": 0.012579040404040398,
        "text": "Figure 2: (left) Scaled Dot-Product Attention. (right) Multi-Head Attention consists of several"
      },
      {
        "x": 0.17647058823529413,
        "y": 0.35727954545454543,
        "width": 0.22832586209150327,
        "height": 0.012579040404040398,
        "text": "attention layers running in parallel."
      }
    ],
    "graphics": [
      {
        "x": 0.2858823529411765,
        "y": 0.11871843434343439,
        "width": 0.1047058823529412,
        "height": 0.16072727272727272,
        "kind": "image"
      },
      {
        "x": 0.5666209150326798,
        "y": 0.10440277777777772,
        "width": 0.19647058823529406,
        "height": 0.23309090909090907,
        "kind": "image"
      }
    ],
    "complexity": {
      "forms": 0,
      "clips": 0,
      "paths": 8
    }
  },
  "attention14": {
    "page": 14,
    "text": [
      {
        "x": 0.17647058823529413,
        "y": 0.772568686868687,
        "width": 0.6493271058823525,
        "height": 0.012579040404040343,
        "text": "Figure 4: Two attention heads, also in layer 5 of 6, apparently involved in anaphora resolution. Top:"
      },
      {
        "x": 0.17647058823529413,
        "y": 0.7863426767676768,
        "width": 0.6470556330823528,
        "height": 0.012579040404040343,
        "text": "Full attentions for head 5. Bottom: Isolated attentions from just the word ‘its’ for attention heads 5"
      },
      {
        "x": 0.17647058823529413,
        "y": 0.8001166666666667,
        "width": 0.3844065954248368,
        "height": 0.012579040404040343,
        "text": "and 6. Note that the attentions are very sharp for this word."
      }
    ],
    "graphics": [
      {
        "x": 0.17647058823529413,
        "y": 0.18458166178000096,
        "width": 0.6470592047597847,
        "height": 0.2689158129674738,
        "kind": "form"
      },
      {
        "x": 0.17647058823529413,
        "y": 0.4547569789901887,
        "width": 0.6471091940995758,
        "height": 0.30781120282799307,
        "kind": "form"
      }
    ],
    "complexity": {
      "forms": 1016,
      "clips": 111,
      "paths": 1141
    }
  },
  "resnet1": {
    "page": 1,
    "text": [
      {
        "x": 0.08188235294117653,
        "y": 0.38332247474747483,
        "width": 0.3860344712418303,
        "height": 0.012579040404040454,
        "text": "stead of learning unreferenced functions. We provide com-"
      },
      {
        "x": 0.08188235294117653,
        "y": 0.3984171717171718,
        "width": 0.38603447124183027,
        "height": 0.012579040404040454,
        "text": "prehensive empirical evidence showing that these residual"
      },
      {
        "x": 0.08188235294117653,
        "y": 0.41351186868686873,
        "width": 0.3860344712418303,
        "height": 0.012579040404040454,
        "text": "networks are easier to optimize, and can gain accuracy from"
      },
      {
        "x": 0.08188235294117653,
        "y": 0.42860782828282834,
        "width": 0.3860344712418303,
        "height": 0.012579040404040454,
        "text": "considerably increased depth. On the ImageNet dataset we"
      },
      {
        "x": 0.5046764705882353,
        "y": 0.38222550505050507,
        "width": 0.38602403137254926,
        "height": 0.01132121212121212,
        "text": "Figure 1. Training error (left) and test error (right) on CIFAR-10"
      },
      {
        "x": 0.5046764705882353,
        "y": 0.3960626262626263,
        "width": 0.38602403137254926,
        "height": 0.01132121212121212,
        "text": "with 20-layer and 56-layer “plain” networks. The deeper network"
      },
      {
        "x": 0.5046764705882353,
        "y": 0.4098997474747475,
        "width": 0.38602403137254926,
        "height": 0.01132121212121212,
        "text": "has higher training error, and thus test error. Similar phenomena"
      },
      {
        "x": 0.5046764705882353,
        "y": 0.4237368686868687,
        "width": 0.20590487843137273,
        "height": 0.01132121212121212,
        "text": "on ImageNet is presented in Fig. 4."
      }
    ],
    "graphics": [
      {
        "x": 0.5046764705882353,
        "y": 0.28340781565656564,
        "width": 0.3860325000000001,
        "height": 0.0988169318181818,
        "kind": "form"
      }
    ],
    "complexity": {
      "forms": 1,
      "clips": 6,
      "paths": 65
    }
  },
  "resnet5": {
    "page": 5,
    "text": [
      {
        "x": 0.08188235294117648,
        "y": 0.28094520202020207,
        "width": 0.8088220235294116,
        "height": 0.01132121212121212,
        "text": "Table 1. Architectures for ImageNet. Building blocks are shown in brackets (see also Fig. 5), with the numbers of blocks stacked. Down-"
      },
      {
        "x": 0.08188235294117648,
        "y": 0.29478232323232323,
        "width": 0.44336551111111105,
        "height": 0.011321212121212065,
        "text": "sampling is performed by conv3 1, conv4 1, and conv5 1 with a stride of 2."
      },
      {
        "x": 0.08188235294117648,
        "y": 0.49268257575757574,
        "width": 0.12463589019607844,
        "height": 0.01132121212121212,
        "text": "Figure 4. Training on"
      },
      {
        "x": 0.21011928104575162,
        "y": 0.49268257575757574,
        "width": 0.061021333333333316,
        "height": 0.01132121212121212,
        "text": "ImageNet"
      },
      {
        "x": 0.2711388888888889,
        "y": 0.49268257575757574,
        "width": 0.6195753098039216,
        "height": 0.01132121212121212,
        "text": ". Thin curves denote training error, and bold curves denote validation error of the center crops. Left: plain"
      },
      {
        "x": 0.08188235294117643,
        "y": 0.5065196969696969,
        "width": 0.8088220235294118,
        "height": 0.011321212121212176,
        "text": "networks of 18 and 34 layers. Right: ResNets of 18 and 34 layers. In this plot, the residual networks have no extra parameter compared to"
      },
      {
        "x": 0.08188235294117643,
        "y": 0.5203568181818181,
        "width": 0.13956523921568637,
        "height": 0.011321212121212176,
        "text": "their plain counterparts."
      },
      {
        "x": 0.08188235294117646,
        "y": 0.7151356060606061,
        "width": 0.3860344712418302,
        "height": 0.012579040404040343,
        "text": "of the 18-layer plain network is a subspace of that of the"
      },
      {
        "x": 0.08188235294117646,
        "y": 0.7302315656565658,
        "width": 0.08588672810457518,
        "height": 0.012579040404040343,
        "text": "34-layer one."
      },
      {
        "x": 0.10141666666666665,
        "y": 0.7492934343434344,
        "width": 0.29122698366013083,
        "height": 0.012579040404040343,
        "text": "We argue that this optimization difficulty is"
      },
      {
        "x": 0.39825816993464047,
        "y": 0.7492934343434344,
        "width": 0.05137576078431377,
        "height": 0.012579040404040343,
        "text": "unlikely"
      },
      {
        "x": 0.4552467320261438,
        "y": 0.7492934343434344,
        "width": 0.012664873856209125,
        "height": 0.012579040404040343,
        "text": "to"
      },
      {
        "x": 0.08188235294117646,
        "y": 0.7643893939393941,
        "width": 0.3860344712418303,
        "height": 0.012579040404040343,
        "text": "be caused by vanishing gradients. These plain networks are"
      },
      {
        "x": 0.08188235294117646,
        "y": 0.7794840909090911,
        "width": 0.3860344712418303,
        "height": 0.012579040404040343,
        "text": "trained with BN [16], which ensures forward propagated"
      },
      {
        "x": 0.5242107843137254,
        "y": 0.7177833333333336,
        "width": 0.36649996143790853,
        "height": 0.012579040404040343,
        "text": "We have three major observations from Table 2 and"
      },
      {
        "x": 0.5046764705882352,
        "y": 0.7328792929292932,
        "width": 0.38603447124183055,
        "height": 0.012579040404040343,
        "text": "Fig. 4. First, the situation is reversed with residual learn-"
      },
      {
        "x": 0.5046764705882352,
        "y": 0.7479739898989902,
        "width": 0.3860344712418301,
        "height": 0.012579040404040343,
        "text": "ing – the 34-layer ResNet is better than the 18-layer ResNet"
      },
      {
        "x": 0.5046764705882352,
        "y": 0.763068686868687,
        "width": 0.3860344712418303,
        "height": 0.012579040404040343,
        "text": "(by 2.8%). More importantly, the 34-layer ResNet exhibits"
      },
      {
        "x": 0.5046764705882352,
        "y": 0.7781633838383841,
        "width": 0.3860344712418301,
        "height": 0.012579040404040343,
        "text": "considerably lower training error and is generalizable to the"
      }
    ],
    "graphics": [
      {
        "x": 0.1385,
        "y": 0.3173588131313131,
        "width": 0.6956540032679739,
        "height": 0.17532426767676768,
        "kind": "form"
      }
    ],
    "complexity": {
      "forms": 1,
      "clips": 10,
      "paths": 280
    }
  }
};
