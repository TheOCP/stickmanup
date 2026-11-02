package io.stickmanup.gl;

import android.opengl.GLES30;

import java.nio.Buffer;

/** GLApi on Android's OpenGL ES 3.0. */
public final class AndroidGL implements GLApi {
    private final int[] one = new int[1];

    private final int[] depth = {GLES30.GL_DEPTH_ATTACHMENT};

    public long fenceSync() { return GLES30.glFenceSync(GLES30.GL_SYNC_GPU_COMMANDS_COMPLETE, 0); }
    public void clientWaitSync(long sync, long nanos) { GLES30.glClientWaitSync(sync, GLES30.GL_SYNC_FLUSH_COMMANDS_BIT, nanos); }
    public void deleteSync(long sync) { GLES30.glDeleteSync(sync); }
    public void invalidateDepth() { GLES30.glInvalidateFramebuffer(GLES30.GL_FRAMEBUFFER, 1, depth, 0); }
    public int createShader(int type) { return GLES30.glCreateShader(type); }
    public void shaderSource(int s, String src) { GLES30.glShaderSource(s, src); }
    public void compileShader(int s) { GLES30.glCompileShader(s); }
    public int getShaderi(int s, int pname) { GLES30.glGetShaderiv(s, pname, one, 0); return one[0]; }
    public String getShaderInfoLog(int s) { return GLES30.glGetShaderInfoLog(s); }
    public int createProgram() { return GLES30.glCreateProgram(); }
    public void attachShader(int p, int s) { GLES30.glAttachShader(p, s); }
    public void bindAttribLocation(int p, int index, String name) { GLES30.glBindAttribLocation(p, index, name); }
    public void linkProgram(int p) { GLES30.glLinkProgram(p); }
    public int getProgrami(int p, int pname) { GLES30.glGetProgramiv(p, pname, one, 0); return one[0]; }
    public String getProgramInfoLog(int p) { return GLES30.glGetProgramInfoLog(p); }
    public void useProgram(int p) { GLES30.glUseProgram(p); }
    public int getUniformLocation(int p, String name) { return GLES30.glGetUniformLocation(p, name); }
    public int getAttribLocation(int p, String name) { return GLES30.glGetAttribLocation(p, name); }
    public void uniform1i(int l, int v) { GLES30.glUniform1i(l, v); }
    public void uniform1f(int l, float v) { GLES30.glUniform1f(l, v); }
    public void uniform2f(int l, float x, float y) { GLES30.glUniform2f(l, x, y); }
    public void uniform3f(int l, float x, float y, float z) { GLES30.glUniform3f(l, x, y, z); }
    public void uniform4f(int l, float x, float y, float z, float w) { GLES30.glUniform4f(l, x, y, z, w); }
    public void uniformMatrix3fv(int l, float[] m) { GLES30.glUniformMatrix3fv(l, 1, false, m, 0); }
    public void uniformMatrix4fv(int l, float[] m) { GLES30.glUniformMatrix4fv(l, 1, false, m, 0); }
    public int genBuffer() { GLES30.glGenBuffers(1, one, 0); return one[0]; }
    public void bindBuffer(int target, int b) { GLES30.glBindBuffer(target, b); }
    public void bufferData(int target, int bytes, Buffer data, int usage) { GLES30.glBufferData(target, bytes, data, usage); }
    public void bufferSubData(int target, int offset, int bytes, Buffer data) { GLES30.glBufferSubData(target, offset, bytes, data); }
    public int genVertexArray() { GLES30.glGenVertexArrays(1, one, 0); return one[0]; }
    public void bindVertexArray(int v) { GLES30.glBindVertexArray(v); }
    public void enableVertexAttribArray(int i) { GLES30.glEnableVertexAttribArray(i); }
    public void disableVertexAttribArray(int i) { GLES30.glDisableVertexAttribArray(i); }
    public void vertexAttribPointer(int i, int size, int type, boolean norm, int stride, int offset) { GLES30.glVertexAttribPointer(i, size, type, norm, stride, offset); }
    public void vertexAttribDivisor(int i, int d) { GLES30.glVertexAttribDivisor(i, d); }
    public void vertexAttrib4f(int i, float x, float y, float z, float w) { GLES30.glVertexAttrib4f(i, x, y, z, w); }
    public void drawArrays(int mode, int first, int count) { GLES30.glDrawArrays(mode, first, count); }
    public void drawElements(int mode, int count, int type, int offset) { GLES30.glDrawElements(mode, count, type, offset); }
    public void drawArraysInstanced(int mode, int first, int count, int n) { GLES30.glDrawArraysInstanced(mode, first, count, n); }
    public void drawElementsInstanced(int mode, int count, int type, int offset, int n) { GLES30.glDrawElementsInstanced(mode, count, type, offset, n); }
    public void viewport(int x, int y, int w, int h) { GLES30.glViewport(x, y, w, h); }
    public void clearColor(float r, float g, float b, float a) { GLES30.glClearColor(r, g, b, a); }
    public void clear(int mask) { GLES30.glClear(mask); }
    public void enable(int cap) { GLES30.glEnable(cap); }
    public void disable(int cap) { GLES30.glDisable(cap); }
    public void blendFunc(int s, int d) { GLES30.glBlendFunc(s, d); }
    public void depthMask(boolean on) { GLES30.glDepthMask(on); }
    public void depthFunc(int f) { GLES30.glDepthFunc(f); }
    public void cullFace(int mode) { GLES30.glCullFace(mode); }
    public int genTexture() { GLES30.glGenTextures(1, one, 0); return one[0]; }
    public void bindTexture(int target, int t) { GLES30.glBindTexture(target, t); }
    public void activeTexture(int unit) { GLES30.glActiveTexture(unit); }
    public void texParameteri(int target, int p, int v) { GLES30.glTexParameteri(target, p, v); }
    public void texImage2D(int target, int level, int ifmt, int w, int h, int fmt, int type, Buffer data) { GLES30.glTexImage2D(target, level, ifmt, w, h, 0, fmt, type, data); }
    public void generateMipmap(int target) { GLES30.glGenerateMipmap(target); }
    public int genFramebuffer() { GLES30.glGenFramebuffers(1, one, 0); return one[0]; }
    public void bindFramebuffer(int target, int f) { GLES30.glBindFramebuffer(target, f); }
    public void framebufferTexture2D(int target, int att, int texTarget, int tex, int level) { GLES30.glFramebufferTexture2D(target, att, texTarget, tex, level); }
    public int genRenderbuffer() { GLES30.glGenRenderbuffers(1, one, 0); return one[0]; }
    public void bindRenderbuffer(int target, int r) { GLES30.glBindRenderbuffer(target, r); }
    public void renderbufferStorage(int target, int fmt, int w, int h) { GLES30.glRenderbufferStorage(target, fmt, w, h); }
    public void framebufferRenderbuffer(int target, int att, int rbTarget, int r) { GLES30.glFramebufferRenderbuffer(target, att, rbTarget, r); }
    public int checkFramebufferStatus(int target) { return GLES30.glCheckFramebufferStatus(target); }
    public void deleteTexture(int t) { one[0] = t; GLES30.glDeleteTextures(1, one, 0); }
    public void deleteFramebuffer(int f) { one[0] = f; GLES30.glDeleteFramebuffers(1, one, 0); }
    public void deleteRenderbuffer(int r) { one[0] = r; GLES30.glDeleteRenderbuffers(1, one, 0); }
    public int getError() { return GLES30.glGetError(); }
    public String getString(int name) { return GLES30.glGetString(name); }
    public void readPixels(int x, int y, int w, int h, int fmt, int type, Buffer buf) { GLES30.glReadPixels(x, y, w, h, fmt, type, buf); }
}
