import com.jogamp.opengl.GL;
import com.jogamp.opengl.GL3ES3;
import com.jogamp.opengl.GL4ES3;
import io.stickmanup.gl.GLApi;

import java.nio.Buffer;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/** GLApi on desktop OpenGL (JOGL, GL4ES3 profile) for testing the native renderer off-device. */
public final class DeskGL implements GLApi {
    private final GL4ES3 g;
    private final int[] one = new int[1];

    public DeskGL(GL4ES3 g) { this.g = g; }

    private final int[] depth = {GL.GL_DEPTH_ATTACHMENT};
    public long fenceSync() { return g.glFenceSync(GL3ES3.GL_SYNC_GPU_COMMANDS_COMPLETE, 0); }
    public void clientWaitSync(long sync, long nanos) { g.glClientWaitSync(sync, GL3ES3.GL_SYNC_FLUSH_COMMANDS_BIT, nanos); }
    public void deleteSync(long sync) { g.glDeleteSync(sync); }
    public void invalidateDepth() { g.glInvalidateFramebuffer(GL.GL_FRAMEBUFFER, 1, depth, 0); }
    public int createShader(int type) { return g.glCreateShader(type); }
    public void shaderSource(int s, String src) { g.glShaderSource(s, 1, new String[]{src}, null); }
    public void compileShader(int s) { g.glCompileShader(s); }
    public int getShaderi(int s, int pname) { g.glGetShaderiv(s, pname, one, 0); return one[0]; }
    public String getShaderInfoLog(int s) { byte[] b = new byte[8192]; int[] n = new int[1]; g.glGetShaderInfoLog(s, b.length, n, 0, b, 0); return new String(b, 0, n[0], StandardCharsets.UTF_8); }
    public int createProgram() { return g.glCreateProgram(); }
    public void attachShader(int p, int s) { g.glAttachShader(p, s); }
    public void bindAttribLocation(int p, int index, String name) { g.glBindAttribLocation(p, index, name); }
    public void linkProgram(int p) { g.glLinkProgram(p); }
    public int getProgrami(int p, int pname) { g.glGetProgramiv(p, pname, one, 0); return one[0]; }
    public String getProgramInfoLog(int p) { byte[] b = new byte[8192]; int[] n = new int[1]; g.glGetProgramInfoLog(p, b.length, n, 0, b, 0); return new String(b, 0, n[0], StandardCharsets.UTF_8); }
    public void useProgram(int p) { g.glUseProgram(p); }
    public int getUniformLocation(int p, String name) { return g.glGetUniformLocation(p, name); }
    public int getAttribLocation(int p, String name) { return g.glGetAttribLocation(p, name); }
    public void uniform1i(int l, int v) { g.glUniform1i(l, v); }
    public void uniform1f(int l, float v) { g.glUniform1f(l, v); }
    public void uniform2f(int l, float x, float y) { g.glUniform2f(l, x, y); }
    public void uniform3f(int l, float x, float y, float z) { g.glUniform3f(l, x, y, z); }
    public void uniform4f(int l, float x, float y, float z, float w) { g.glUniform4f(l, x, y, z, w); }
    public void uniformMatrix3fv(int l, float[] m) { g.glUniformMatrix3fv(l, 1, false, m, 0); }
    public void uniformMatrix4fv(int l, float[] m) { g.glUniformMatrix4fv(l, 1, false, m, 0); }
    public int genBuffer() { g.glGenBuffers(1, one, 0); return one[0]; }
    public void bindBuffer(int target, int b) { g.glBindBuffer(target, b); }
    public void bufferData(int target, int bytes, Buffer data, int usage) { g.glBufferData(target, bytes, data, usage); }
    public void bufferSubData(int target, int offset, int bytes, Buffer data) { g.glBufferSubData(target, offset, bytes, data); }
    public int genVertexArray() { g.glGenVertexArrays(1, one, 0); return one[0]; }
    public void bindVertexArray(int v) { g.glBindVertexArray(v); }
    public void enableVertexAttribArray(int i) { g.glEnableVertexAttribArray(i); }
    public void disableVertexAttribArray(int i) { g.glDisableVertexAttribArray(i); }
    public void vertexAttribPointer(int i, int size, int type, boolean norm, int stride, int offset) { g.glVertexAttribPointer(i, size, type, norm, stride, offset); }
    public void vertexAttribDivisor(int i, int d) { g.glVertexAttribDivisor(i, d); }
    public void vertexAttrib4f(int i, float x, float y, float z, float w) { g.glVertexAttrib4f(i, x, y, z, w); }
    public void drawArrays(int mode, int first, int count) { g.glDrawArrays(mode, first, count); }
    public void drawElements(int mode, int count, int type, int offset) { g.glDrawElements(mode, count, type, offset); }
    public void drawArraysInstanced(int mode, int first, int count, int n) { g.glDrawArraysInstanced(mode, first, count, n); }
    public void drawElementsInstanced(int mode, int count, int type, int offset, int n) { g.glDrawElementsInstanced(mode, count, type, offset, n); }
    public void viewport(int x, int y, int w, int h) { g.glViewport(x, y, w, h); }
    public void clearColor(float r, float gg, float b, float a) { g.glClearColor(r, gg, b, a); }
    public void clear(int mask) { g.glClear(mask); }
    public void enable(int cap) { g.glEnable(cap); }
    public void disable(int cap) { g.glDisable(cap); }
    public void blendFunc(int s, int d) { g.glBlendFunc(s, d); }
    public void depthMask(boolean on) { g.glDepthMask(on); }
    public void depthFunc(int f) { g.glDepthFunc(f); }
    public void cullFace(int mode) { g.glCullFace(mode); }
    public int genTexture() { g.glGenTextures(1, one, 0); return one[0]; }
    public void bindTexture(int target, int t) { g.glBindTexture(target, t); }
    public void activeTexture(int unit) { g.glActiveTexture(unit); }
    public void texParameteri(int target, int p, int v) { g.glTexParameteri(target, p, v); }
    public void texImage2D(int target, int level, int ifmt, int w, int h, int fmt, int type, Buffer data) { g.glTexImage2D(target, level, ifmt, w, h, 0, fmt, type, data); }
    public void generateMipmap(int target) { g.glGenerateMipmap(target); }
    public int genFramebuffer() { g.glGenFramebuffers(1, one, 0); return one[0]; }
    public void bindFramebuffer(int target, int f) { g.glBindFramebuffer(target, f); }
    public void framebufferTexture2D(int target, int att, int texTarget, int tex, int level) { g.glFramebufferTexture2D(target, att, texTarget, tex, level); }
    public int genRenderbuffer() { g.glGenRenderbuffers(1, one, 0); return one[0]; }
    public void bindRenderbuffer(int target, int r) { g.glBindRenderbuffer(target, r); }
    public void renderbufferStorage(int target, int fmt, int w, int h) { g.glRenderbufferStorage(target, fmt, w, h); }
    public void framebufferRenderbuffer(int target, int att, int rbTarget, int r) { g.glFramebufferRenderbuffer(target, att, rbTarget, r); }
    public int checkFramebufferStatus(int target) { return g.glCheckFramebufferStatus(target); }
    public void deleteTexture(int t) { one[0] = t; g.glDeleteTextures(1, one, 0); }
    public void deleteBuffer(int b) { one[0] = b; g.glDeleteBuffers(1, one, 0); }
    public void deleteVertexArray(int v) { one[0] = v; g.glDeleteVertexArrays(1, one, 0); }
    public void deleteFramebuffer(int f) { one[0] = f; g.glDeleteFramebuffers(1, one, 0); }
    public void deleteRenderbuffer(int r) { one[0] = r; g.glDeleteRenderbuffers(1, one, 0); }
    public int getError() { return g.glGetError(); }
    public String getString(int name) { return g.glGetString(name); }
    public void readPixels(int x, int y, int w, int h, int fmt, int type, Buffer buf) { g.glReadPixels(x, y, w, h, fmt, type, buf); }
}
