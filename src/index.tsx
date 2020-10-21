/******************************************************************************
 *
 * Copyright (c) 2017, the Perspective Authors.
 *
 * This file is part of the Perspective library, distributed under the terms of
 * the Apache License 2.0.  The full license can be found in the LICENSE file.
 *
 */

import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { useEffect, useRef } from 'react'
import perspective, { Table } from '@finos/perspective'
import '@finos/perspective-viewer'
import '@finos/perspective-viewer-datagrid'
import '@finos/perspective-viewer-d3fc'
import './index.css'
import '@finos/perspective-viewer/dist/umd/material.css'
import {
  HTMLPerspectiveViewerElement,
  PerspectiveViewerOptions
} from '@finos/perspective-viewer'

const worker = perspective.shared_worker()

const getTable = async (): Promise<Table> => {
  const annotationsUrl =
    'https://raw.githubusercontent.com/jimpick/workshop-client-testnet/spacerace/src/annotations-spacerace-slingshot-medium.json'
  const resp2 = await fetch(annotationsUrl)
  const annotations = await resp2.json()
  const resp = await fetch(
    'https://api.storage.codefi.network/asks?limit=1000&offset=0'
  )
  const json = await resp.json()
  const data = json.map(
    ({
      miner: { address: minerAddress, score },
      price: {
        raw: priceRaw,
        value: priceValue,
        prices: { usd: priceUsd }
      },
      minPieceSize: { raw: minPieceSize },
      maxPieceSize: { raw: maxPieceSize }
    }) => {
      const annotation = annotations[minerAddress]
      const match = annotation && annotation.match(/^([^,]*), (.*)/)
      const annotationState = match ? match[1] : ''
      const annotationExtra = match ? match[2] : ''
      return {
        minerNum: Number(minerAddress.slice(1)),
        miner: minerAddress,
        priceRaw,
        priceValue,
        priceUsd,
        score,
        annotationState,
        annotationExtra,
        minPieceSize,
        maxPieceSize
      }
    }
  )
  return worker.table(data)
  /*
  var data = [
    { x: 1, y: 'a', z: true },
    { x: 2, y: 'b', z: false },
    { x: 3, y: 'c', z: true },
    { x: 4, y: 'd', z: false }
  ]

  return worker.table(data)
  */
}

const config: PerspectiveViewerOptions = {
  // 'row-pivots': ['State']
}

const App = (): React.ReactElement => {
  const viewer = useRef<HTMLPerspectiveViewerElement>(null)

  useEffect(() => {
    getTable().then(table => {
      if (viewer.current) {
        viewer.current.load(table)
        viewer.current.restore(config)
      }
    })
  }, [])

  // You can also the use the stringified config values as attributes
  return (
    <perspective-viewer
      ref={viewer} /*row-pivots='["State"]'*/
    ></perspective-viewer>
  )
}
window.addEventListener('load', () => {
  ReactDOM.render(<App />, document.getElementById('root'))
})
