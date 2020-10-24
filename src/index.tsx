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
  const annotationsResp = await fetch(annotationsUrl)
  const annotations = await annotationsResp.json()

  const retrievalsUrl =
    'https://raw.githubusercontent.com/jimpick/filecoin-wiki-test/master/wiki-small-blocks-combined-128/retrievals/retrieval-success-miners.json'
  const retrievalsResp = await fetch(retrievalsUrl)
  const retrievals = new Set(await retrievalsResp.json())

  const asksUrl = 'https://api.storage.codefi.network/asks?limit=1000&offset=0'
  const asksResp = await fetch(asksUrl)
  const asks = await asksResp.json()

  const data = asks.map(
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
        stored:
          annotationState === 'active' ||
          annotationState === 'active-sealing' ||
          annotationState === 'sealing',
        retrieved: retrievals.has(minerAddress),
        minPieceSize,
        maxPieceSize
      }
    }
  )
  return worker.table(data)
}

const config: PerspectiveViewerOptions = {
  // 'row-pivots': ['State']
  filters: [
    ['retrieved', '==', 'true'],
    ['stored', '==', 'true']
  ],
  sort: [
    ['priceRaw', 'asc'],
    ['minerNum', 'asc']
  ]
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
